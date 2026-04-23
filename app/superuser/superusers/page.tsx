'use client'

import { useEffect, useState, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { useRouter } from 'next/navigation'

const supabase = createClient()

export default function SuperuserManagement() {
  const [superusers, setSuperusers] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [showAddForm, setShowAddForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error'>('success')
  const [editingUser, setEditingUser] = useState<any>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const router = useRouter()

  const showMessage = (msg: string, type: 'success' | 'error') => {
    setMessage(msg)
    setMessageType(type)
    setTimeout(() => setMessage(''), 4000)
  }

  const fetchSuperusers = useCallback(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'superuser')
      .eq('is_deleted', false)
      .order('created_at', { ascending: true })
    if (data) setSuperusers(data)
  }, [])

  const fetchCurrentUser = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single()
      setCurrentUser(profile)
    }
  }, [])

  useEffect(() => {
    fetchCurrentUser()
    fetchSuperusers()
  }, [fetchCurrentUser, fetchSuperusers])

  const logAction = async (action: string, entity_id: string, details: object) => {
    await fetch('/api/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: currentUser?.id,
        user_email: currentUser?.email,
        user_role: currentUser?.role,
        action,
        entity: 'profile',
        entity_id,
        details,
      }),
    })
  }

  const handleAddSuperuser = async (e: React.FormEvent) => {
    e.preventDefault()

    const res = await fetch('/api/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: newEmail,
        password: newPassword,
        full_name: newName,
        role: 'superuser',
        actor_id: currentUser?.id,
        actor_email: currentUser?.email,
        actor_role: currentUser?.role,
      }),
    })

    const result = await res.json()

    if (!res.ok) {
      showMessage('Error creating user: ' + result.error, 'error')
      return
    }

    showMessage('Superuser created successfully!', 'success')
    setNewName('')
    setNewEmail('')
    setNewPassword('')
    setShowAddForm(false)
    fetchSuperusers()
  }

  const handleFreeze = async (user: any) => {
    if (user.id === currentUser?.id) return
    const { error } = await supabase
      .from('profiles')
      .update({ is_frozen: !user.is_frozen })
      .eq('id', user.id)
    if (error) {
      showMessage('Error updating user', 'error')
    } else {
      await logAction(
        user.is_frozen ? 'UNFREEZE_USER' : 'FREEZE_USER',
        user.id,
        { email: user.email, full_name: user.full_name }
      )
      showMessage(user.is_frozen ? 'User unfrozen' : 'User frozen', 'success')
      fetchSuperusers()
    }
  }

  const handleSoftDelete = async (user: any) => {
    if (user.id === currentUser?.id) return
    const confirmed = confirm(`Remove ${user.full_name} from superusers list?`)
    if (!confirmed) return
    const { error } = await supabase
      .from('profiles')
      .update({ is_deleted: true })
      .eq('id', user.id)
    if (error) {
      showMessage('Error removing user', 'error')
    } else {
      await logAction('REMOVE_USER', user.id, { email: user.email, full_name: user.full_name })
      showMessage('User removed from superusers list', 'success')
      fetchSuperusers()
    }
  }

  const handleEdit = (user: any) => {
    setEditingUser(user)
    setEditName(user.full_name)
    setEditEmail(user.email)
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    const { error } = await supabase
      .from('profiles')
      .update({ full_name: editName, email: editEmail })
      .eq('id', editingUser.id)
    if (error) {
      showMessage('Error updating user', 'error')
    } else {
      await logAction('EDIT_USER', editingUser.id, {
        old_name: editingUser.full_name,
        new_name: editName,
        old_email: editingUser.email,
        new_email: editEmail,
      })
      showMessage('User updated successfully', 'success')
      setEditingUser(null)
      fetchSuperusers()
    }
  }

  return (
    <main className="min-h-screen bg-gray-100">
      <div className="bg-blue-700 text-white px-6 py-4 flex justify-between items-center">
        <h1 className="text-2xl font-bold">South Lincs Systems</h1>
        <button
          onClick={() => router.push('/superuser')}
          className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded-lg text-sm"
        >
          ← Back to Dashboard
        </button>
      </div>

      <div className="max-w-4xl mx-auto p-6 space-y-6">

        <div className="flex justify-between items-center">
          <h2 className="text-2xl font-bold text-gray-800">Superuser Management</h2>
          <button
            onClick={() => setShowAddForm(!showAddForm)}
            className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 transition"
          >
            {showAddForm ? 'Cancel' : '+ Add Superuser'}
          </button>
        </div>

        {message && (
          <div className={`p-4 rounded-lg text-sm font-medium ${
            messageType === 'success' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
          }`}>
            {message}
          </div>
        )}

        {showAddForm && (
          <div className="bg-white rounded-xl shadow p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">New Superuser</h3>
            <form onSubmit={handleAddSuperuser} className="space-y-4" autoComplete="off">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoComplete="new-password"
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition font-medium"
              >
                Create Superuser
              </button>
            </form>
          </div>
        )}

        {editingUser && (
          <div className="bg-white rounded-xl shadow p-6 border-l-4 border-blue-500">
            <h3 className="text-lg font-semibold text-gray-800 mb-4">Edit {editingUser.full_name}</h3>
            <form onSubmit={handleSaveEdit} className="space-y-4" autoComplete="off">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoComplete="off"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
                <input
                  type="email"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoComplete="off"
                  required
                />
              </div>
              <div className="flex gap-3">
                <button
                  type="submit"
                  className="flex-1 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition"
                >
                  Save Changes
                </button>
                <button
                  type="button"
                  onClick={() => setEditingUser(null)}
                  className="flex-1 bg-gray-200 text-gray-700 py-2 rounded-lg hover:bg-gray-300 transition"
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        )}

        <div className="bg-white rounded-xl shadow p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-4">
            Active Superusers ({superusers.length})
          </h3>
          {superusers.length === 0 ? (
            <p className="text-gray-400">No superusers found.</p>
          ) : (
            <ul className="space-y-3">
              {superusers.map((user) => (
                <li
                  key={user.id}
                  className={`flex justify-between items-center border rounded-lg px-4 py-3 ${
                    user.is_frozen ? 'border-orange-300 bg-orange-50' : 'border-gray-200'
                  }`}
                >
                  <div>
                    <p className="font-medium text-gray-800">
                      {user.full_name}
                      {user.id === currentUser?.id && (
                        <span className="ml-2 text-xs bg-blue-100 text-blue-600 px-2 py-0.5 rounded-full">You</span>
                      )}
                      {user.is_frozen && (
                        <span className="ml-2 text-xs bg-orange-100 text-orange-600 px-2 py-0.5 rounded-full">Frozen</span>
                      )}
                    </p>
                    <p className="text-sm text-gray-500">{user.email}</p>
                  </div>

                  {user.id !== currentUser?.id && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(user)}
                        className="text-sm bg-gray-100 hover:bg-gray-200 text-gray-700 px-3 py-1.5 rounded-lg transition"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleFreeze(user)}
                        className={`text-sm px-3 py-1.5 rounded-lg transition ${
                          user.is_frozen
                            ? 'bg-green-100 hover:bg-green-200 text-green-700'
                            : 'bg-orange-100 hover:bg-orange-200 text-orange-700'
                        }`}
                      >
                        {user.is_frozen ? 'Unfreeze' : 'Freeze'}
                      </button>
                      <button
                        onClick={() => handleSoftDelete(user)}
                        className="text-sm bg-red-100 hover:bg-red-200 text-red-700 px-3 py-1.5 rounded-lg transition"
                      >
                        Remove
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

      </div>
    </main>
  )
}