import Link from 'next/link'

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-100">
      <div className="bg-white p-8 rounded-xl shadow-md w-full max-w-md text-center">
        <h1 className="text-3xl font-bold text-blue-700 mb-2">South Lincs Systems</h1>
        <p className="text-gray-500 mb-8">Please sign in to continue</p>
        <Link href="/login">
          <button className="w-full bg-blue-600 text-white py-3 rounded-lg hover:bg-blue-700 transition">
            Go to Login
          </button>
        </Link>
      </div>
    </main>
  )
}