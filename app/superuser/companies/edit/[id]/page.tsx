'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import CompanyForm, { type CompanyFormValues } from '@/components/CompanyForm'

export default function EditCompanyByIdPage() {
  const params = useParams()
  const router = useRouter()
  const id = params?.id as string | undefined

  const [values, setValues] = useState<CompanyFormValues | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    if (!id) return
    const load = async () => {
      try {
        const res = await fetch(`/api/get-company?id=${encodeURIComponent(id)}`)
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load')
        if (cancelled) return
        const c = data.company
        setValues({
          id: c.id,
          name: c.name,
          is_active: !!c.is_active,
          start_date: c.start_date,
          subscription_length: c.subscription_length,
          override_end_date: c.override_end_date,
          contact_name: c.contact_name,
          contact_phone: c.contact_phone,
          contact_email: c.contact_email,
          notes: c.notes,
          enabled_feature_ids: data.enabled_feature_ids || [],
        })
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  if (loading) {
    return <div className="p-8 text-slate-400 italic">Loading company…</div>
  }
  if (error) {
    return (
      <div className="p-8 max-w-3xl">
        <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-lg">
          <p className="font-medium mb-1">Couldn&apos;t load company</p>
          <p className="text-sm">{error}</p>
          <button
            onClick={() => router.push('/superuser/companies/edit')}
            className="mt-3 text-sm underline"
          >
            Back to list
          </button>
        </div>
      </div>
    )
  }
  if (!values) return null

  return (
    <>
      {/* Manage Users button — sits above the form */}
      <div className="px-8 pt-8 max-w-3xl">
        <button
          onClick={() => router.push(`/superuser/companies/${id}/users`)}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium px-5 py-3 rounded-lg flex items-center justify-between transition"
        >
          <span>👥 Manage Users</span>
          <span className="text-blue-100">›</span>
        </button>
      </div>

      <CompanyForm mode="edit" initialValues={values} />
    </>
  )
}
