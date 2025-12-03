import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Info } from "lucide-react";
import MultiPrintCalculator from "@/components/calculator/MultiPrintCalculator";

export default function Calculator() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Job Calculator</h1>
          <p className="text-slate-500 mt-1">Calculate costs and profit margins for orders</p>
        </div>

        {/* Price Reference Card */}
        <Card className="bg-gradient-to-r from-slate-800 to-slate-900 text-white border-0 mb-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Info className="w-5 h-5" />
              Quick Price Reference
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-slate-400">DTF (Randburg)</p>
                <p className="text-lg font-semibold">R212.75/m</p>
              </div>
              <div>
                <p className="text-slate-400">DTF (Joburg)</p>
                <p className="text-lg font-semibold">R170/m</p>
              </div>
              <div>
                <p className="text-slate-400">Vinyl Videoflex</p>
                <p className="text-lg font-semibold">R110/m</p>
              </div>
              <div>
                <p className="text-slate-400">DTF A4 Print</p>
                <p className="text-lg font-semibold">R80</p>
              </div>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mt-4 pt-4 border-t border-slate-700">
              <div>
                <p className="text-slate-400">JV1 T-Shirt</p>
                <p className="font-semibold">R95</p>
              </div>
              <div>
                <p className="text-slate-400">JET T-Shirt</p>
                <p className="font-semibold">R155</p>
              </div>
              <div>
                <p className="text-slate-400">JHG T-Shirt</p>
                <p className="font-semibold">R229</p>
              </div>
              <div>
                <p className="text-slate-400">Embroidery Setup</p>
                <p className="font-semibold">R300</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <MultiPrintCalculator />

        {/* Tips */}
        <Card className="mt-6 bg-amber-50 border-0">
          <CardContent className="p-4">
            <h4 className="font-medium text-amber-800 mb-2">💡 Pricing Tips</h4>
            <ul className="text-sm text-amber-700 space-y-1">
              <li>• <strong>Bulk discounts:</strong> 50+ items = 10% off, 100+ items = 15% off</li>
              <li>• Extra R15 for sizes above 2XL</li>
              <li>• Rush order fee: R420</li>
              <li>• Screen printing requires minimum 50 pieces</li>
              <li>• Setup fees are once-off per design (don't charge again for repeats)</li>
              <li>• Aim for at least 30% profit margin</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}