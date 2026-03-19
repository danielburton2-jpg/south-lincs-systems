export function requireLogin(router:any){

  const user = localStorage.getItem("user")

  if(!user){
    router.push("/login")
    return null
  }

  return JSON.parse(user)
}
