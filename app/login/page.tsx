"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/login.css";

export default function LoginPage() {

  const router = useRouter();

  const [email,setEmail] = useState("");
  const [password,setPassword] = useState("");

  const [loading,setLoading] = useState(false);
  const [checkingSession,setCheckingSession] = useState(true);
  const [error,setError] = useState("");

  useEffect(()=>{

    const checkSession = async()=>{

      try {

        const { data } = await supabase.auth.getSession();

        const session = data.session;

        if(session){
          router.replace("/dev/dashboard");
        }

      } catch(err) {

        console.error(err);

      }

      setCheckingSession(false);

    };

    checkSession();

  },[router]);

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

      router.replace("/dev/dashboard");

    }

  };

  if(checkingSession){

    return(
      <div className="login-page">
        <div className="login-card">
          <h1 className="login-title">South Lincs Systems</h1>
          <p>Checking session...</p>
        </div>
      </div>
    );

  }

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
            type="email"
            placeholder="Email"
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