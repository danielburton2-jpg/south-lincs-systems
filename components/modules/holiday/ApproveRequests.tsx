"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

export default function ApproveRequests(){

const [requests,setRequests] = useState<any[]>([])

useEffect(()=>{

loadRequests()

},[])

const loadRequests = async ()=>{

const { data } = await supabase
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

if(data){
setRequests(data)
}

}

const updateStatus = async (id:any,status:any)=>{

await supabase
.from("holiday_requests")
.update({ status })
.eq("id",id)

loadRequests()

}

return(

<div>

<h1>Holiday Requests</h1>

<table>

<thead>

<tr>
<th>Employee</th>
<th>Start</th>
<th>End</th>
<th>Reason</th>
<th>Status</th>
<th>Action</th>
</tr>

</thead>

<tbody>

{requests.map((r)=>(

<tr key={r.id}>

<td>
{r.company_users?.first_name} {r.company_users?.last_name}
</td>

<td>{r.start_date}</td>
<td>{r.end_date}</td>
<td>{r.reason}</td>
<td>{r.status}</td>

<td>

<button
onClick={()=>updateStatus(r.id,"approved")}
>
Approve
</button>

<button
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