import React from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { motion } from "framer-motion";
import { Check } from "lucide-react";

export default function TypeformInput({ 
  type = "text",
  label,
  subtitle,
  value,
  onChange,
  options = [],
  placeholder,
  required,
  unit,
  isActive,
  questionNumber
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: isActive ? 1 : 0.3, y: 0 }}
      transition={{ duration: 0.4 }}
      className={`transition-all duration-300 ${isActive ? '' : 'pointer-events-none'}`}
    >
      <div className="mb-3">
        {questionNumber && (
          <span className="text-sm text-slate-400 mb-1 block">
            {questionNumber} →
          </span>
        )}
        <h2 className="text-2xl md:text-3xl font-medium text-slate-900">
          {label}
          {required && <span className="text-blue-500 ml-1">*</span>}
        </h2>
        {subtitle && (
          <p className="text-slate-500 mt-2">{subtitle}</p>
        )}
      </div>

      {type === "text" && isActive && (
        <div className="relative">
          <Input
            type="text"
            value={value || ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="text-xl md:text-2xl h-16 border-0 border-b-2 border-slate-200 rounded-none px-0 focus:ring-0 focus:border-blue-500 bg-transparent"
          />
          {unit && (
            <span className="absolute right-0 top-1/2 -translate-y-1/2 text-slate-400">{unit}</span>
          )}
        </div>
      )}

      {type === "number" && isActive && (
        <div className="relative">
          <Input
            type="number"
            value={value || ""}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            placeholder={placeholder}
            className="text-xl md:text-2xl h-16 border-0 border-b-2 border-slate-200 rounded-none px-0 focus:ring-0 focus:border-blue-500 bg-transparent"
          />
          {unit && (
            <span className="absolute right-0 top-1/2 -translate-y-1/2 text-slate-400">{unit}</span>
          )}
        </div>
      )}

      {type === "email" && isActive && (
        <Input
          type="email"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || "name@example.com"}
          className="text-xl md:text-2xl h-16 border-0 border-b-2 border-slate-200 rounded-none px-0 focus:ring-0 focus:border-blue-500 bg-transparent"
        />
      )}

      {type === "textarea" && isActive && (
        <Textarea
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="text-lg border-0 border-b-2 border-slate-200 rounded-none px-0 focus:ring-0 focus:border-blue-500 bg-transparent resize-none"
        />
      )}

      {type === "select" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
          {options.map((option, index) => {
            const optionValue = typeof option === 'object' ? option.value : option;
            const optionLabel = typeof option === 'object' ? option.label : option;
            const isSelected = value === optionValue;
            
            return (
              <button
                key={optionValue}
                type="button"
                onClick={() => onChange(optionValue)}
                className={`
                  flex items-center gap-3 p-4 rounded-xl border-2 text-left transition-all
                  ${isSelected 
                    ? 'border-blue-500 bg-blue-50 text-blue-700' 
                    : 'border-slate-200 hover:border-slate-300 text-slate-700'}
                `}
              >
                <span className="w-6 h-6 rounded border-2 flex items-center justify-center text-xs font-medium
                  ${isSelected ? 'border-blue-500 bg-blue-500 text-white' : 'border-slate-300'}">
                  {isSelected ? <Check className="w-4 h-4" /> : String.fromCharCode(65 + index)}
                </span>
                <span className="font-medium">{optionLabel}</span>
              </button>
            );
          })}
        </div>
      )}

      {type === "date" && isActive && (
        <Input
          type="date"
          value={value || ""}
          onChange={(e) => onChange(e.target.value)}
          className="text-xl h-16 border-0 border-b-2 border-slate-200 rounded-none px-0 focus:ring-0 focus:border-blue-500 bg-transparent"
        />
      )}
    </motion.div>
  );
}