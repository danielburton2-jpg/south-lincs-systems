"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

export default function ApproveRequests(){

const [requests,setRequests] = useState<any[]>([])
const [loading,setLoading] = useState(true)

useEffect(()=>{
loadRequests()
},[])

const loadRequests = async ()=>{

setLoading(true)

const { data,error } = await supabase
.from("holiday_requests")
.select(`
id,
start_date,
end_date,
reason,
status,
company_users (
first_name,
last_name
)
`)
.eq("status","pending")
.order("start_date",{ ascending:true })

if(!error && data){
setRequests(data)
}

setLoading(false)

}

const updateStatus = async (id:any,status:any)=>{

await supabase
.from("holiday_requests")
.update({ status })
.eq("id",id)

/* Remove from UI immediately */

setRequests(prev => prev.filter(r => r.id !== id))

}

if(loading){
return <p>Loading requests...</p>
}

return(

<div className="page-container">

<h1 className="page-title">
Approve Holiday Requests
</h1>

<table className="table">

<thead>

<tr>
<th>Employee</th>
<th>Start Date</th>
<th>End Date</th>
<th>Reason</th>
<th>Action</th>
</tr>

</thead>

<tbody>

{requests.length === 0 && (

<tr>
<td colSpan={5}>
No pending requests
</td>
</tr>

)}

{requests.map((r)=>(

<tr key={r.id}>

<td>
{r.company_users?.first_name} {r.company_users?.last_name}
</td>

<td>{r.start_date}</td>
<td>{r.end_date}</td>
<td>{r.reason}</td>

<td>

<button
className="approve-btn"
onClick={()=>updateStatus(r.id,"approved")}
>
Approve
</button>

<button
className="reject-btn"
onClick={()=>updateStatus(r.id,"rejected")}
>
Reject
</button>

</td>

</tr>

))}

</tbody>

</table>

</div>

)

}