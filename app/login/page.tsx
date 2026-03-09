"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/forms.css";
import "@/styles/buttons.css";

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();

      if (data.session) {
        router.replace("/dev/dashboard");
      } else {
        setCheckingSession(false);
      }
    };

    checkSession();
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    setLoading(true);
    setError("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
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
        description: `User ${user.email} logged in`,
      });
    }

    router.replace("/dev/dashboard");
  };

  if (checkingSession) {
    return <div>Checking session...</div>;
  }

  return (
    <div className="form-container">
      <h1>South Lincs Systems Login</h1>

      {error && <div className="form-error">{error}</div>}

      <form onSubmit={handleLogin} autoComplete="off">
        <input
          className="form-input"
          type="email"
          placeholder="Email"
          autoComplete="off"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />

        <input
          className="form-input"
          type="password"
          placeholder="Password"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />

        <button className="btn-primary" type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Login"}
        </button>
      </form>
    </div>
  );
}