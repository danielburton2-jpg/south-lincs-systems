export type AuditParams = {
  userId?: string
  action: string
  description?: string
}

export async function auditLog(params: AuditParams) {

  try {

    await fetch("/api/audit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(params)
    });

  } catch (error) {

    console.error("Audit log failed:", error);

  }

}