"use client";

import { useRouter } from "next/navigation";

export default function SuperusersPage() {

  const router = useRouter();

  return (

    <div>

      <h1>Superusers</h1>

      <div className="page-actions">

        <button
          onClick={() => router.push("/dev/superusers/create")}
        >
          Create Superuser
        </button>

        <button
          onClick={() => router.push("/dev/superusers/view")}
        >
          View Superusers
        </button>

      </div>

    </div>

  );

}