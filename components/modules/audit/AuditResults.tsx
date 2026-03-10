"use client"

import "@/styles/modules.css"

export default function AuditResults({ results, setShowResults }: any) {

  const download = () => {

    const data =
      "data:text/json;charset=utf-8," +
      encodeURIComponent(JSON.stringify(results))

    const link = document.createElement("a")

    link.href = data
    link.download = "audit_logs.json"

    link.click()

  }

  const printResults = () => {

    window.print()

  }

  return (

    <div>

      <div className="results-toolbar">

        <button onClick={download}>
          Download
        </button>

        <button onClick={printResults}>
          Print
        </button>

        <button onClick={()=>setShowResults(false)}>
          Close
        </button>

      </div>

      <table>

        <thead>

          <tr>

            <th>Time</th>
            <th>User</th>
            <th>Action</th>
            <th>Description</th>

          </tr>

        </thead>

        <tbody>

          {results?.map((log:any)=>(

            <tr key={log.id}>

              <td>
                {new Date(log.created_at).toLocaleString()}
              </td>

              <td>{log.user_name}</td>

              <td>{log.action}</td>

              <td>{log.description}</td>

            </tr>

          ))}

        </tbody>

      </table>

    </div>

  )

}