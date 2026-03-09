"use client";

import { useRouter, useParams } from "next/navigation";

export default function EditSuperuser() {

  const router = useRouter();
  const params = useParams();

  const id = params.id;

  return (

    <div>

      <button onClick={() => router.back()}>
        Back
      </button>

      <h1>Edit Superuser</h1>

      <p>Superuser ID: {id}</p>

      <button>
        Freeze
      </button>

      <button>
        Delete
      </button>

    </div>

  );

}