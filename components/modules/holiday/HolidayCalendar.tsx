"use client"

import { useEffect,useState } from "react"
import { supabase } from "@/supabase/client"
import "@/styles/calendar.css"

export default function HolidayCalender(){

const [users,setUsers] = useState<any[]>([])
const [holidays,setHolidays] = useState<any[]>([])
const [timeRequests,setTimeRequests] = useState<any[]>([])
const [pending,setPending] = useState<any[]>([])
const [rejected,setRejected] = useState<any[]>([])
const [selected,setSelected] = useState<any>(null)

const [month,setMonth] = useState(new Date())

const year = month.getFullYear()
const monthIndex = month.getMonth()
const daysInMonth = new Date(year,monthIndex+1,0).getDate()

useEffect(()=>{
loadData()
},[])

const loadData = async ()=>{

const { data:session } = await supabase.auth.getSession()
const userId = session?.session?.user?.id
if(!userId) return

const { data:me } = await supabase
.from("company_users")
.select("company_id")
.eq("id",userId)
.single()

if(!me) return
const companyId = me.company_id

/* USERS */

const { data:usersData } = await supabase
.from("company_users")
.select("*")
.eq("company_id",companyId)
.order("first_name")

if(usersData) setUsers(usersData)

/* APPROVED HOLIDAYS */

const { data:holidayData } = await supabase
.from("holiday_requests")
.select("*")
.eq("company_id",companyId)
.eq("status","approved")

if(holidayData) setHolidays(holidayData)

/* PENDING */

const { data:pendingData } = await supabase
.from("holiday_requests")
.select("*")
.eq("company_id",companyId)
.eq("status","pending")

if(pendingData) setPending(pendingData)

/* REJECTED */

const { data:rejectedData } = await supabase
.from("holiday_requests")
.select("*")
.eq("company_id",companyId)
.eq("status","rejected")

if(rejectedData) setRejected(rejectedData)

/* TIME REQUESTS */

const { data:timeData } = await supabase
.from("time_requests")
.select("*")
.eq("company_id",companyId)
.eq("status","approved")

if(timeData) setTimeRequests(timeData)

}

/* CELL TYPE */

const getCellData = (userId:any,day:number)=>{

const date = new Date(year,monthIndex,day)

/* APPROVED */

const approved = holidays.find((h:any)=>{

const start = new Date(h.start_date)
const end = new Date(h.end_date)

return h.user_id === userId &&
date >= start &&
date <= end

})

if(approved) return {type:"holiday",data:approved}

/* PENDING */

const pendingReq = pending.find((h:any)=>{

const start = new Date(h.start_date)
const end = new Date(h.end_date)

return h.user_id === userId &&
date >= start &&
date <= end

})

if(pendingReq) return {type:"pending",data:pendingReq}

/* REJECTED */

const rejectedReq = rejected.find((h:any)=>{

const start = new Date(h.start_date)
const end = new Date(h.end_date)

return h.user_id === userId &&
date >= start &&
date <= end

})

if(rejectedReq) return {type:"rejected",data:rejectedReq}

/* TIME REQUEST */

const time = timeRequests.find((t:any)=>{

const d = new Date(t.date)

return t.user_id === userId &&
d.toDateString() === date.toDateString()

})

if(!time) return {type:""}

if(time.type==="early_finish")
return {type:"early",data:time}

if(time.type==="half_day")
return {type:"half",data:time}

return {type:""}

}

/* APPROVE */

const approveRequest = async(id:any)=>{

const { error } = await supabase
.from("holiday_requests")
.update({ status:"approved" })
.eq("id",id)

if(error){
console.error("Approve error:",error)
alert(error.message)
return
}

setSelected(null)
loadData()

}

/* REJECT */

const rejectRequest = async(id:any)=>{

const reason = prompt("Reason for rejection")
if(!reason) return

const { error } = await supabase
.from("holiday_requests")
.update({
status:"rejected",
rejection_reason:reason
})
.eq("id",id)

if(error){
console.error("Reject error:",error)
alert(error.message)
return
}

setSelected(null)
loadData()

}

/* MONTH NAVIGATION */

const previousMonth = ()=>{
setMonth(new Date(year,monthIndex-1,1))
}

const nextMonth = ()=>{
setMonth(new Date(year,monthIndex+1,1))
}

/* DAY LETTER */

const getDayLetter = (day:number)=>{
const date = new Date(year,monthIndex,day)
return date.toLocaleDateString("en-GB",{weekday:"short"}).charAt(0)
}

return(

<div className="calendar-wrapper">

<div className="calendar-header">

<button onClick={previousMonth}>Previous</button>

<h1>
{month.toLocaleString("default",{month:"long"})} {year}
</h1>

<button onClick={nextMonth}>Next</button>

</div>

<table className="calendar-table">

<thead>

<tr>

<th className="user-col">
Users
</th>

{Array.from({length:daysInMonth},(_,i)=>{

const day=i+1

return(

<th key={i} className="date-header">

<div className="day-letter">
{getDayLetter(day)}
</div>

<div className="day-number">
{day}
</div>

</th>

)

})}

</tr>

</thead>

<tbody>

{users.map((user:any)=>(

<tr key={user.id}>

<td className="user-name">
{user.first_name} {user.last_name}
</td>

{Array.from({length:daysInMonth},(_,i)=>{

const cell = getCellData(user.id,i+1)

return(

<td
key={i}
className={`calendar-cell ${cell.type}`}
onClick={()=>cell.data && setSelected(cell.data)}
>

</td>

)

})}

</tr>

))}

</tbody>

</table>

{selected && (

<div className="calendar-popup">

<h3>Holiday Request</h3>

<p>
{selected.start_date} → {selected.end_date}
</p>

<button onClick={()=>approveRequest(selected.id)}>
Approve
</button>

<button onClick={()=>rejectRequest(selected.id)}>
Reject
</button>

<button onClick={()=>setSelected(null)}>
Close
</button>

</div>

)}

</div>

)

}