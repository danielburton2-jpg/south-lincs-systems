"use client";

import { useRouter } from "next/navigation";

import "@/styles/buttons.css";

export default function SuperusersPage() {

  const router = useRouter();

  return (

    <div>

      <h1>Superusers</h1>

      <div>

        <button
          className="btn-primary"
          onClick={() =>
            router.push("/dev/superusers/create")
          }
        >
          Create Superuser
        </button>

        <button
          className="btn-secondary"
          onClick={() =>
            router.push("/dev/superusers/view")
          }
        >
          View Superusers
        </button>

      </div>

    </div>

  );

}