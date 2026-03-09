"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";
import "@/styles/login.css";

export default function LoginPage() {

  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  /*
  --------------------------------
  AUTO REFRESH PAGE
  --------------------------------
  Refresh every 30 seconds
  */

  useEffect(() => {

    const interval = setInterval(() => {
      window.location.reload();
    }, 30000);

    return () => clearInterval(interval);

  }, []);

  /*
  --------------------------------
  LOGIN HANDLER
  --------------------------------
  */

  const handleLogin = async (e: React.FormEvent) => {

    e.preventDefault();

    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {
      setError(error.message);
      setLoading(false);
      return;
    }

    const user = data?.user;

    if (user) {

      await auditLog({
        userId: user.id,
        action: "login",
        description: "User logged into the system"
      });

    }

    router.replace("/dev/dashboard");

  };

  /*
  --------------------------------
  UI
  --------------------------------
  */

  return (

    <div className="login-container">

      <div className="login-card">

        <h1 className="login-title">
          South Lincs Systems
        </h1>

        <form onSubmit={handleLogin} className="login-form">

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <div className="login-field">

            <label>Email</label>

            <input
              type="email"
              placeholder="Enter email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />

          </div>

          <div className="login-field">

            <label>Password</label>

            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />

          </div>

          <button
            type="submit"
            className="login-button"
            disabled={loading}
          >

            {loading ? "Signing In..." : "Login"}

          </button>

        </form>

      </div>

    </div>

  );

}