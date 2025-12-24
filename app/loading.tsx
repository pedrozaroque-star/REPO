export default function Loading() {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center">
        <div className="text-8xl mb-6 animate-bounce">🌮</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-4">Cargando Tacos Gavilan...</h2>
        <div className="flex justify-center space-x-2">
          <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse"></div>
          <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse delay-100"></div>
          <div className="w-3 h-3 bg-red-600 rounded-full animate-pulse delay-200"></div>
        </div>
      </div>
    </div>
  )
}