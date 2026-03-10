"use client";

import { useState } from "react";
import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/login.css";

export default function LoginPage() {

  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState("");

  const handleLogin = async (e:React.FormEvent)=>{

    e.preventDefault();

    setLoading(true);
    setError("");

    const { data,error } =
      await supabase.auth.signInWithPassword({
        email,
        password
      });

    if(error){

      setError(error.message);
      setLoading(false);
      return;

    }

    const user = data?.user;

    if(user){

      await auditLog({
        userId:user.id,
        action:"login",
        description:`User ${user.email} logged in`
      });

      // force full navigation so middleware sees the cookie
      window.location.href = "/dev/dashboard";

    }

  };

  return(

    <div className="login-page">

      <div className="login-card">

        <h1 className="login-title">
          South Lincs Systems
        </h1>

        {error && (
          <div className="form-error">
            {error}
          </div>
        )}

        <form
          className="login-form"
          onSubmit={handleLogin}
        >

          <input
            id="email"
            name="email"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e)=>setEmail(e.target.value)}
            required
          />

          <input
            id="password"
            name="password"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e)=>setPassword(e.target.value)}
            required
          />

          <button
            className="login-button"
            type="submit"
            disabled={loading}
          >
            {loading ? "Signing in..." : "Login"}
          </button>

        </form>

      </div>

    </div>

  );

}