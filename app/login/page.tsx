"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/supabase/client";
import "@/styles/login.css";

export default function LoginPage() {

  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [loading, setLoading] = useState(false);
  const [checkingSession, setCheckingSession] = useState(true);

  const [error, setError] = useState("");

  /*
  --------------------------------
  CHECK IF USER ALREADY LOGGED IN
  --------------------------------
  */

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

  /*
  --------------------------------
  LOGIN HANDLER
  --------------------------------
  */

  const handleLogin = async (e: React.FormEvent) => {

    e.preventDefault();

    setLoading(true);
    setError("");

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password
    });

    if (error) {

      setError(error.message);
      setLoading(false);
      return;

    }

    router.replace("/dev/dashboard");

  };

  /*
  --------------------------------
  LOADING SCREEN
  --------------------------------
  */

  if (checkingSession) {
    return (
      <div className="login-loading">
        Checking session...
      </div>
    );
  }

  /*
  --------------------------------
  UI
  --------------------------------
  */

  return (

    <div className="login-container">

      <div className="login-card">

        <h1>South Lincs Systems</h1>

        <form onSubmit={handleLogin} className="login-form">

          {error && (
            <div className="login-error">
              {error}
            </div>
          )}

          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            required
          />

          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
            required
          />

          <button type="submit" disabled={loading}>

            {loading ? "Signing in..." : "Login"}

          </button>

        </form>

      </div>

    </div>

  );

}