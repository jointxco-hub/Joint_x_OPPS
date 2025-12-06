import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Receipt, X, Trash2, ShoppingCart } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

export default function FloatingCart({ cart, onRemove, onCheckout, onUpdateQuantity }) {
  const [isOpen, setIsOpen] = useState(false);

  const totalItems = cart.reduce((sum, item) => sum + item.quantity, 0);
  const totalPrice = cart.reduce((sum, item) => sum + (item.total || 0), 0);

  if (cart.length === 0) return null;

  return (
    <>
      {/* Floating Cart Button */}
      <motion.button
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-6 right-6 z-50 bg-[#0F9B8E] hover:bg-[#0d8577] text-white rounded-full p-4 shadow-2xl flex items-center gap-3"
      >
        <Receipt className="w-6 h-6" />
        <div className="flex flex-col items-start">
          <span className="text-xs opacity-90">{totalItems} items</span>
          <span className="font-bold">R{totalPrice.toFixed(2)}</span>
        </div>
        <Badge className="bg-white text-[#0F9B8E] absolute -top-2 -right-2 rounded-full px-2">
          {totalItems}
        </Badge>
      </motion.button>

      {/* Cart Panel */}
      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 bg-black/40 z-40"
            />

            {/* Cart Panel */}
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25 }}
              className="fixed top-0 right-0 h-full w-full md:w-96 bg-white shadow-2xl z-50 flex flex-col"
            >
              {/* Header */}
              <div className="p-6 border-b bg-[#0F9B8E] text-white">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <ShoppingCart className="w-5 h-5" />
                    Your Cart
                  </h2>
                  <button
                    onClick={() => setIsOpen(false)}
                    className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                <p className="text-sm opacity-90 mt-1">{totalItems} items</p>
              </div>

              {/* Cart Items */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {cart.map((item, index) => (
                  <Card key={index} className="border-slate-200">
                    <CardContent className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <div className="flex-1">
                          <p className="font-semibold text-slate-900">{item.name}</p>
                          <p className="text-xs text-slate-500">
                            {item.size} • {item.color}
                          </p>
                          {item.printOptions?.length > 0 && (
                            <div className="mt-1">
                              {item.printOptions.map((print, i) => (
                                <p key={i} className="text-xs text-slate-600">
                                  {print.type} @ {print.location}
                                  {print.customSize && ` (${print.customSize})`}
                                </p>
                              ))}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => onRemove(index)}
                          className="text-red-500 hover:text-red-700"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                      
                      <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => onUpdateQuantity(index, item.quantity - 1)}
                            className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                          >
                            −
                          </button>
                          <span className="w-8 text-center font-medium">{item.quantity}</span>
                          <button
                            onClick={() => onUpdateQuantity(index, item.quantity + 1)}
                            className="w-6 h-6 rounded bg-slate-100 hover:bg-slate-200 flex items-center justify-center"
                          >
                            +
                          </button>
                        </div>
                        <p className="font-bold text-[#0F9B8E]">R{item.total.toFixed(2)}</p>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* Footer */}
              <div className="p-6 border-t bg-slate-50">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-lg font-semibold">Total</span>
                  <span className="text-2xl font-bold text-[#0F9B8E]">
                    R{totalPrice.toFixed(2)}
                  </span>
                </div>
                <Button
                  onClick={() => {
                    setIsOpen(false);
                    onCheckout();
                  }}
                  className="w-full bg-[#0F9B8E] hover:bg-[#0d8577] h-12 text-lg"
                >
                  Proceed to Checkout
                </Button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}