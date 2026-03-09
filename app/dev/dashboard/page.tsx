"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/supabase/client";

export default function DevDashboard() {

  const [name, setName] = useState<string>("");

  useEffect(() => {

    const getUser = async () => {

      const { data } = await supabase.auth.getUser();

      const user = data?.user;

      if (user) {

        // if name exists in metadata
        const userName =
          user.user_metadata?.name ||
          user.email?.split("@")[0] ||
          "User";

        setName(userName);

      }

    };

    getUser();

  }, []);

  return (

    <div className="dashboard-container">

      <h1>
        Welcome, {name}
      </h1>

      <p>
        This is the South Lincs Systems developer dashboard.
      </p>

    </div>

  );

}