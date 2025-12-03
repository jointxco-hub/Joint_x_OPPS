import React, { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronDown, ChevronUp, Check, ArrowRight } from "lucide-react";

export default function TypeformWrapper({ 
  children, 
  onSubmit, 
  submitLabel = "Submit",
  currentStep,
  setCurrentStep,
  totalSteps,
  isSubmitting
}) {
  const containerRef = useRef(null);

  const goNext = () => {
    if (currentStep < totalSteps - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const goPrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (currentStep < totalSteps - 1) {
        goNext();
      }
    }
  };

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep]);

  const progress = ((currentStep + 1) / totalSteps) * 100;

  return (
    <div className="min-h-screen bg-white flex flex-col" ref={containerRef}>
      {/* Progress Bar */}
      <div className="fixed top-0 left-0 right-0 h-1 bg-slate-100 z-50">
        <motion.div 
          className="h-full bg-blue-500"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.3 }}
        />
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-2xl">
          <AnimatePresence mode="wait">
            <motion.div
              key={currentStep}
              initial={{ opacity: 0, x: 50 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -50 }}
              transition={{ duration: 0.3 }}
            >
              {children}
            </motion.div>
          </AnimatePresence>

          {/* Navigation */}
          <div className="mt-12 flex items-center gap-4">
            {currentStep < totalSteps - 1 ? (
              <Button 
                onClick={goNext}
                className="bg-blue-600 hover:bg-blue-700 text-white px-8 py-6 text-lg rounded-lg"
              >
                OK <Check className="w-5 h-5 ml-2" />
              </Button>
            ) : (
              <Button 
                onClick={onSubmit}
                disabled={isSubmitting}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-8 py-6 text-lg rounded-lg"
              >
                {isSubmitting ? "Saving..." : submitLabel} <ArrowRight className="w-5 h-5 ml-2" />
              </Button>
            )}
            <span className="text-sm text-slate-400">
              press <kbd className="px-2 py-1 bg-slate-100 rounded text-slate-600">Enter ↵</kbd>
            </span>
          </div>
        </div>
      </div>

      {/* Bottom Navigation */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-2">
        <Button 
          variant="outline" 
          size="icon" 
          onClick={goPrev}
          disabled={currentStep === 0}
          className="rounded-lg shadow-lg"
        >
          <ChevronUp className="w-5 h-5" />
        </Button>
        <Button 
          variant="outline" 
          size="icon" 
          onClick={goNext}
          disabled={currentStep === totalSteps - 1}
          className="rounded-lg shadow-lg"
        >
          <ChevronDown className="w-5 h-5" />
        </Button>
      </div>

      {/* Step Counter */}
      <div className="fixed bottom-6 left-6 text-sm text-slate-400">
        {currentStep + 1} of {totalSteps}
      </div>
    </div>
  );
}