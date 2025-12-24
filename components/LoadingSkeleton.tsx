export default function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        {[1, 2, 3, 4].map(i => (
          <div key={i} className="bg-gray-200 h-32 rounded-xl"></div>
        ))}
      </div>
      <div className="bg-gray-200 h-64 rounded-xl"></div>
      <div className="space-y-4">
        {[1, 2, 3].map(i => (
          <div key={i} className="bg-gray-200 h-24 rounded-xl"></div>
        ))}
      </div>
    </div>
  )
}