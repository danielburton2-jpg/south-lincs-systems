"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/supabase/client";
import { auditLog } from "@/lib/audit/auditLogger";

import "@/styles/forms.css";
import "@/styles/buttons.css";

export default function CreateCompanyPage() {

  const router = useRouter();

  const [name,setName] = useState("");
  const [email,setEmail] = useState("");
  const [phone,setPhone] = useState("");
  const [address,setAddress] = useState("");

  const [subscription,setSubscription] = useState("trial");

  const [startDate,setStartDate] = useState("");
  const [endDate,setEndDate] = useState("");

  const [freeOverride,setFreeOverride] = useState(false);
  const [active,setActive] = useState(true);


  /* AUTO FILL SUBSCRIPTION DATES */

  useEffect(()=>{

    const start = new Date();
    const end = new Date();

    if(subscription === "trial"){
      end.setMonth(end.getMonth() + 1);
    }

    if(subscription === "yearly"){
      end.setFullYear(end.getFullYear() + 1);
    }

    const startISO = start.toISOString().split("T")[0];
    const endISO = end.toISOString().split("T")[0];

    setStartDate(startISO);
    setEndDate(endISO);

  },[subscription]);


  const handleSubmit = async (e:React.FormEvent)=>{

    e.preventDefault();

    const { data,error } = await supabase
      .from("companies")
      .insert([
        {
          name,
          contact_email: email,
          contact_phone: phone,
          company_address: address,
          subscription,
          subscription_start: startDate,
          subscription_end: endDate,
          free_override: freeOverride,
          active
        }
      ])
      .select()
      .single();

    if(error){
      alert(error.message);
      return;
    }

    const { data:userData } = await supabase.auth.getUser();

    if(userData.user){

      await auditLog({
        userId:userData.user.id,
        action:"create_company",
        description:`Created company ${data.name}`
      });

    }

    router.push("/dev/companies/view");

  };


  return(

    <div className="form-card">

      <div className="form-title">
        Create Company
      </div>

      <form onSubmit={handleSubmit}>


        {/* COMPANY INFORMATION */}

        <div className="form-section">

          <div className="form-section-title">
            Company Information
          </div>

          <div className="form-grid">

            <input
              className="form-input form-full"
              placeholder="Company Name"
              value={name}
              onChange={(e)=>setName(e.target.value)}
              required
            />

            <textarea
              className="form-input form-full"
              placeholder="Company Address"
              value={address}
              onChange={(e)=>setAddress(e.target.value)}
            />

          </div>

        </div>



        {/* CONTACT INFORMATION */}

        <div className="form-section">

          <div className="form-section-title">
            Contact Information
          </div>

          <div className="form-grid">

            <input
              className="form-input form-full"
              placeholder="Contact Email"
              value={email}
              onChange={(e)=>setEmail(e.target.value)}
            />

            <input
              className="form-input"
              placeholder="Contact Phone"
              value={phone}
              onChange={(e)=>setPhone(e.target.value)}
            />

          </div>

        </div>



        {/* SUBSCRIPTION */}

        <div className="form-section">

          <div className="form-section-title">
            Subscription
          </div>

          <select
            className="form-input form-full"
            value={subscription}
            onChange={(e)=>setSubscription(e.target.value)}
          >
            <option value="trial">Trial (1 Month)</option>
            <option value="yearly">Yearly</option>
          </select>


          <div className="form-dates">

            <div>
              <label className="form-label">Start Date</label>
              <input
                type="date"
                className="form-input"
                value={startDate}
                onChange={(e)=>setStartDate(e.target.value)}
              />
            </div>

            <div>
              <label className="form-label">End Date</label>
              <input
                type="date"
                className="form-input"
                value={endDate}
                onChange={(e)=>setEndDate(e.target.value)}
              />
            </div>

          </div>

        </div>



        {/* SETTINGS */}

        <div className="form-section">

          <div className="form-section-title">
            Settings
          </div>

          <div className="form-checkbox-row">

            <label>
              <input
                type="checkbox"
                checked={freeOverride}
                onChange={(e)=>setFreeOverride(e.target.checked)}
              />
              Free Override
            </label>

            <label>
              <input
                type="checkbox"
                checked={active}
                onChange={(e)=>setActive(e.target.checked)}
              />
              Active
            </label>

          </div>

        </div>



        {/* BUTTONS */}

        <div className="form-actions">

          <button
            className="btn btn-success"
            type="submit"
          >
            Submit
          </button>

          <button
            className="btn btn-cancel"
            type="button"
            onClick={() => router.back()}
          >
            Cancel
          </button>

        </div>

      </form>

    </div>

  );

}