"use client"

import { useState } from "react"
import { supabase } from "@/supabase/client"

export default function RequestHoliday({ close }: any){

const [startDate,setStartDate] = useState("")
const [endDate,setEndDate] = useState("")
const [reason,setReason] = useState("")

const handleSubmit = async (e:any)=>{

e.preventDefault()

/* GET USER SESSION */

const { data: sessionData } =
await supabase.auth.getSession()

const userId =
sessionData?.session?.user?.id

if(!userId){
alert("User not logged in")
return
}

/* GET COMPANY ID */

const { data:user } = await supabase
.from("company_users")
.select("company_id")
.eq("id",userId)
.single()

if(!user){
alert("User company not found")
return
}

const companyId = user.company_id

/* INSERT HOLIDAY REQUEST */

const { error } = await supabase
.from("holiday_requests")
.insert({
user_id: userId,
company_id: companyId,
start_date: startDate,
end_date: endDate,
reason: reason,
status: "pending"
})

if(error){
alert(error.message)
return
}

alert("Holiday Request Submitted")

setStartDate("")
setEndDate("")
setReason("")

}

return(

<div className="page-container">

<h1 className="page-title">
Request Holiday
</h1>

<form className="form" onSubmit={handleSubmit}>

<div className="form-group">

<label>Start Date</label>

<input
type="date"
value={startDate}
onChange={(e)=>setStartDate(e.target.value)}
required
/>

</div>

<div className="form-group">

<label>End Date</label>

<input
type="date"
value={endDate}
onChange={(e)=>setEndDate(e.target.value)}
required
/>

</div>

<div className="form-group">

<label>Reason</label>

<textarea
value={reason}
onChange={(e)=>setReason(e.target.value)}
/>

</div>

<div className="form-buttons">

<button
type="button"
className="cancel-btn"
onClick={close}
>
Cancel
</button>

<button
type="submit"
className="create-btn"
>
Submit Request
</button>

</div>

</form>

</div>

)

}