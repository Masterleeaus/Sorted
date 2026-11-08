"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog } from "@/components/ui";

interface Props {
  estimateId: string;
  status: string;
  estimateNumber?: string | null;
}

export function DeleteEstimateButton({ estimateId, status, estimateNumber }: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const label = estimateNumber?.trim() || "this estimate";
  const body =
    status === "draft"
      ? `Permanently delete ${label}? This cannot be undone. The delete is written to the audit log.`
      : `Permanently delete ${label} (status: ${status})? Use this for wrong or test estimates. Linked unpaid invoices keep their rows but lose the estimate link. Deletes are recorded in the audit log. Cannot delete if a linked invoice has payments.`;

  async function handleDelete() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/estimates/${estimateId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error?.message ?? "Delete failed");
      } else {
        router.push("/app/estimates");
        router.refresh();
      }
    } catch {
      setError("Unexpected error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div data-testid="delete-estimate-panel">
      {error && <p className="error-inline" data-testid="delete-estimate-error">{error}</p>}
      <Button
        variant="danger"
        onClick={() => setConfirmOpen(true)}
        disabled={loading}
        data-testid="delete-estimate-btn"
      >
        {loading ? "Deleting…" : "Delete Estimate"}
      </Button>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete Estimate?"
        body={body}
        confirmLabel="Delete Estimate"
        onConfirm={() => {
          setConfirmOpen(false);
          handleDelete();
        }}
        onCancel={() => setConfirmOpen(false)}
        loading={loading}
      />
    </div>
  );
}
