"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { ModelConfig } from "../lib/types";

export function ModelRow({
  model,
  active,
  editing,
  editingName,
  editingModel,
  onEditingNameChange,
  onEditingModelChange,
  onSubmitEdit,
  onStartEdit,
  onCancelEdit,
  onSelect,
  onDelete,
  onTest,
}: {
  model: ModelConfig;
  active: boolean;
  editing: boolean;
  editingName: string;
  editingModel: string;
  onEditingNameChange: (value: string) => void;
  onEditingModelChange: (value: string) => void;
  onSubmitEdit: (event: FormEvent) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSelect: () => void;
  onDelete: () => void;
  onTest: (signal: AbortSignal) => Promise<void>;
}) {
  const [testResult, setTestResult] = useState<{ status: "pending" | "success" | "error"; message: string } | null>(null);
  const requestRef = useRef<AbortController | null>(null);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  async function testModel() {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setTestResult({ status: "pending", message: "正在发送测试请求…" });
    try {
      await onTest(controller.signal);
      if (!controller.signal.aborted) {
        setTestResult({ status: "success", message: "测试成功，模型可用。" });
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setTestResult({ status: "error", message: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      if (requestRef.current === controller) requestRef.current = null;
    }
  }

  if (editing) {
    return (
      <form className="model-edit-row" onSubmit={onSubmitEdit}>
        <input placeholder="显示名称" value={editingName} onChange={(event) => onEditingNameChange(event.target.value)} />
        <input placeholder="模型 ID" value={editingModel} onChange={(event) => onEditingModelChange(event.target.value)} />
        <div className="model-edit-actions">
          <button className="icon-button" title="保存模型">
            <Check size={15} />
          </button>
          <button className="icon-button cancel-icon-button" type="button" title="取消" onClick={onCancelEdit}>
            <X size={15} />
          </button>
        </div>
      </form>
    );
  }

  return (
    <div className={active ? "model-row active" : "model-row"}>
      <button className="model-name" type="button" onClick={onSelect}>
        <strong>{model.name}</strong>
        <span>{model.model}</span>
      </button>
      <button className="text-button compact" type="button" disabled={testResult?.status === "pending"} onClick={() => void testModel()} aria-label={`测试 ${model.name}`}>
        {testResult?.status === "pending" ? "测试中…" : "测试"}
      </button>
      <button className="icon-button" type="button" title="编辑模型" onClick={onStartEdit}>
        <Pencil size={15} />
      </button>
      <button className="icon-button danger" type="button" title="删除模型" onClick={onDelete}>
        <Trash2 size={15} />
      </button>
      {testResult && (
        <pre className={`model-test-result ${testResult.status}`} role={testResult.status === "error" ? "alert" : "status"}>
          {testResult.message}
        </pre>
      )}
    </div>
  );
}

