/** Session-local Codex subscription speed preference; never stores request content. */
export const FAST_ENTRY = "codex-limit-fast";

export interface FastModel {
	id: string;
	provider: string;
	api: string;
}

export type FastPhase = "idle" | "requested" | "fast" | "standard" | "unknown";

function fastRecord(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown> : undefined;
}

/** Fast requests follow the selected provider/API, independent of how Pi classified auth. */
export function isCodexFastModel(model: FastModel | undefined): boolean {
	return model?.provider === "openai-codex" && model.api === "openai-codex-responses";
}

/** Quota API access still requires host-confirmed OAuth credentials. */
export function isCodexSubscription(model: FastModel | undefined, oauth: boolean): boolean {
	return oauth && isCodexFastModel(model);
}

export function restoreFastMode(entries: readonly unknown[], sessionId: string): boolean {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = fastRecord(entries[i]);
		const data = fastRecord(entry?.data);
		if (entry?.type === "custom" && entry.customType === FAST_ENTRY && data?.sessionId === sessionId
			&& typeof data.enabled === "boolean") return data.enabled;
	}
	return false;
}

export class FastModeController {
	enabled = false;
	phase: FastPhase = "idle";
	private request: { model: string; responseId?: string } | undefined;
	private overlapping = false;

	setEnabled(enabled: boolean): void {
		this.enabled = enabled;
		this.resetResponse();
	}

	resetSession(enabled: boolean): void {
		this.request = undefined;
		this.overlapping = false;
		this.setEnabled(enabled);
	}

	resetResponse(): void {
		if (this.request) this.overlapping = true;
		this.phase = this.overlapping ? "unknown" : "idle";
		this.request = undefined;
	}

	transform(payload: unknown, model: FastModel | undefined): unknown {
		const body = fastRecord(payload);
		if (!this.enabled || !isCodexFastModel(model) || body?.model !== model?.id) return undefined;
		// The public payload hook has no request ID. If background warming overlaps a
		// foreground stream, never attribute one stream's tier to the other request.
		if (this.request) this.overlapping = true;
		this.request = { model: model!.id };
		this.phase = this.overlapping ? "unknown" : "requested";
		// The Codex subscription backend uses its catalog tier ID (`priority`).
		// `fast` is accepted by the public API but rejected by this endpoint.
		return { ...body, service_tier: "priority" };
	}

	observe(event: { provider: string; api: string; model: string; data: unknown }): void {
		if (!this.enabled || !this.request || event.provider !== "openai-codex"
			|| event.api !== "openai-codex-responses" || event.model !== this.request.model) return;
		const data = fastRecord(event.data);
		const response = fastRecord(data?.response);
		if (!response) return;
		if (typeof response.id === "string") {
			if (this.request.responseId && this.request.responseId !== response.id) return;
			this.request.responseId = response.id;
		}
		if (!["response.completed", "response.done", "response.incomplete", "response.failed"].includes(String(data?.type))) return;
		this.phase = this.overlapping || data?.type === "response.failed" || data?.type === "response.incomplete" ? "unknown"
			: response.service_tier === "fast" || response.service_tier === "priority" ? "fast"
			: response.service_tier === "standard" ? "standard" : "unknown";
		this.request = undefined;
	}

	settle(): void {
		if (this.request) this.overlapping = true;
		if (this.phase === "requested") this.phase = "unknown";
		this.request = undefined;
	}

	suffix(): string {
		if (!this.enabled) return "";
		return this.phase === "fast" ? " · Fast" : this.phase === "standard" ? " · Fast未生效"
			: this.phase === "unknown" ? " · Fast未确认" : " · Fast待确认";
	}

	details(model: FastModel | undefined): string[] {
		const applicable = isCodexFastModel(model);
		const modelId = model && /^[a-zA-Z0-9._:/-]{1,128}$/.test(model.id) ? model.id : "未知模型";
		const tier = !applicable ? "当前模型未应用" : !this.enabled ? "Fast 已关闭"
			: this.phase === "fast" ? "Fast（已确认）" : this.phase === "standard" ? "标准（Fast 未生效）"
				: this.phase === "unknown" ? "未确认（响应缺少档位、请求失败或并发结果无法归属）" : "等待下一次请求确认";
		return ["▸ Fast 模式", `Fast 开关：${this.enabled ? "开启" : "关闭"}（仅当前会话）`,
			`当前模型：${modelId}`, `服务端档位：${tier}`,
			"Fast 消耗：订阅额度按标准的 2.5 倍", "使用 /fast on 或 /fast off；新会话默认关闭。"];
	}
}
