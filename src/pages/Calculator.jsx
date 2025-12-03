import React from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Info } from "lucide-react";
import JobCalculator from "@/components/calculator/JobCalculator";

export default function Calculator() {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-3xl mx-auto p-4 md:p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900">Job Calculator</h1>
          <p className="text-slate-500 mt-1">Calculate costs and profit margins</p>
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
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-slate-400">Vinyl Videoflex</p>
                <p className="text-lg font-semibold">R110/m</p>
              </div>
              <div>
                <p className="text-slate-400">DTF Randburg (Quality)</p>
                <p className="text-lg font-semibold">R212.75/m</p>
              </div>
              <div>
                <p className="text-slate-400">DTF Joburg</p>
                <p className="text-lg font-semibold">R170/m</p>
              </div>
              <div>
                <p className="text-slate-400">Vinyl Flock</p>
                <p className="text-lg font-semibold">~R150/m</p>
              </div>
              <div>
                <p className="text-slate-400">Vinyl Silicon</p>
                <p className="text-lg font-semibold">~R180/m</p>
              </div>
              <div>
                <p className="text-slate-400 text-xs">Vinyl is cut in-house</p>
                <p className="text-xs text-slate-500">Blanks from Joburg</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <JobCalculator />

        {/* Tips */}
        <Card className="mt-6 bg-amber-50 border-0">
          <CardContent className="p-4">
            <h4 className="font-medium text-amber-800 mb-2">💡 Remember</h4>
            <ul className="text-sm text-amber-700 space-y-1">
              <li>• DTF Randburg offers better quality but costs more</li>
              <li>• Factor in transport costs (Uber, petrol) for each job</li>
              <li>• Delivery via Pep Paxi at Riverside View</li>
              <li>• Aim for at least 30% profit margin</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}