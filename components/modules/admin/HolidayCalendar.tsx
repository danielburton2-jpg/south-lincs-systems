"use client"

import { useEffect,useState } from "react"
import { supabase } from "@/supabase/client"

export default function HolidayCalendar({ company }:any){

const [holidays,setHolidays] = useState<any[]>([])

useEffect(()=>{

load()

},[company])

const load = async()=>{

if(!company) return

const { data } = await supabase
.from("holiday_requests")
.select(`
*,
employee:company_users(first_name,last_name)
`)
.eq("company_id",company.company_id)
.eq("status","approved")

setHolidays(data || [])

}

return(

<div>

<h1>Holiday Calendar</h1>

<p>Week / Month view coming next.</p>

<ul>

{holidays.map(h=>(

<li key={h.id}>

{h.employee.first_name} {h.employee.last_name}
{" "}
{h.start_date} → {h.end_date}

</li>

))}

</ul>

</div>

)

}