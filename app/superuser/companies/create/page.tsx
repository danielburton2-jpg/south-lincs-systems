'use client'

import CompanyForm, { type CompanyFormValues } from '@/components/CompanyForm'

const EMPTY: CompanyFormValues = {
  name: '',
  is_active: true,
  start_date: null,
  subscription_length: null,
  override_end_date: null,
  contact_name: null,
  contact_phone: null,
  contact_email: null,
  notes: null,
  enabled_feature_ids: [],
}

export default function CreateCompanyPage() {
  return <CompanyForm mode="create" initialValues={EMPTY} />
}
