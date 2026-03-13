"use client"

import { useEffect, useState } from "react"
import { supabase } from "@/supabase/client"

export default function HolidayCalendar(){

const [users,setUsers] = useState<any[]>([])
const [holidays,setHolidays] = useState<any[]>([])
const [timeRequests,setTimeRequests] = useState<any[]>([])

const [month,setMonth] = useState(new Date())

const year = month.getFullYear()
const monthIndex = month.getMonth()

const daysInMonth = new Date(year,monthIndex+1,0).getDate()

useEffect(()=>{
loadData()
},[])

const loadData = async ()=>{

/* users */

const { data:usersData } = await supabase
.from("company_users")
.select("*")
.eq("status","active")

if(usersData) setUsers(usersData)

/* holidays */

const { data:holidayData } = await supabase
.from("holiday_requests")
.select("*")
.eq("status","approved")

if(holidayData) setHolidays(holidayData)

/* early finish / half day */

const { data:timeData } = await supabase
.from("time_requests")
.select("*")
.eq("status","approved")

if(timeData) setTimeRequests(timeData)

}

const getCellType = (userId:any,day:number)=>{

const date = new Date(year,monthIndex,day)

/* holiday */

const holiday = holidays.find((h:any)=>{

const start = new Date(h.start_date)
const end = new Date(h.end_date)

return h.user_id === userId && date >= start && date <= end

})

if(holiday) return "holiday"

/* time requests */

const time = timeRequests.find((t:any)=>{

const d = new Date(t.date)

return t.user_id === userId &&
d.toDateString() === date.toDateString()

})

if(time){

if(time.type === "early_finish") return "early"

if(time.type === "half_day") return "half"

}

return ""

}

const prevMonth = ()=>{
setMonth(new Date(year,monthIndex-1,1))
}

const nextMonth = ()=>{
setMonth(new Date(year,monthIndex+1,1))
}

return(

<div className="planner">

<h1>
{month.toLocaleString("default",{month:"long"})} {year}
</h1>

<div className="planner-nav">

<button onClick={prevMonth}>Previous</button>
<button onClick={nextMonth}>Next</button>

</div>

<div className="planner-table">

{/* HEADER */}

<div className="planner-header">

<div className="planner-user-col">
Employee
</div>

{Array.from({length:daysInMonth},(_,i)=>(

<div key={i} className="planner-day">

{i+1}

</div>

))}

</div>

{/* USERS */}

{users.map((user:any)=>(

<div key={user.id} className="planner-row">

<div className="planner-user">

{user.first_name} {user.last_name}

</div>

{Array.from({length:daysInMonth},(_,i)=>{

const type = getCellType(user.id,i+1)

return(

<div
key={i}
className={`planner-cell ${type}`}
>

</div>

)

})}

</div>

))}

</div>

</div>

)

}