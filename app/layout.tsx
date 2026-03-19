export const metadata = {
  title: "South Lincs Systems",
  description: "Platform"
}

export default function RootLayout({
  children
}:{
  children: React.ReactNode
}){

  return(

    <html lang="en">

      <body>

        {children}

      </body>

    </html>

  )

}