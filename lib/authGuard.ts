export function requireAuth(router:any){

  if(typeof window === "undefined") return

  const user = localStorage.getItem("user")

  if(!user){
    router.push("/login")
    return null
  }

  return JSON.parse(user)
}
