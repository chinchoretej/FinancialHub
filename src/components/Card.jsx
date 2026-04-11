export default function Card({ children, className = '' }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-700 p-4 ${className}`}>
      {children}
    </div>
  );
}
