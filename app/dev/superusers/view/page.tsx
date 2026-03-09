"use client";

import { useRouter } from "next/navigation";

const superusers = [
  { id: 1, name: "Daniel Burton" },
  { id: 2, name: "Admin User" }
];

export default function ViewSuperusers() {

  const router = useRouter();

  return (

    <div>

      <button onClick={() => router.back()}>
        Back
      </button>

      <h1>Superusers</h1>

      <div>

        {superusers.map((user) => (

          <button
            key={user.id}
            onClick={() => router.push(`/dev/superusers/edit/${user.id}`)}
          >
            {user.name}
          </button>

        ))}

      </div>

    </div>

  );

}