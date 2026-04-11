export default function EmptyState({ icon: Icon, message, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-gray-400">
      {Icon && <Icon className="w-12 h-12 mb-3" />}
      <p className="text-sm mb-3">{message}</p>
      {action}
    </div>
  );
}
