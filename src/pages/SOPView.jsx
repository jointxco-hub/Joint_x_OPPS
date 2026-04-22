import React, { useState } from "react";
import { dataClient } from "@/api/dataClient";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { 
  ArrowLeft, Edit2, Crown, Clock, AlertCircle, CheckCircle2,
  Video, Plus, History, User, Youtube, Upload
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { createPageUrl } from "../utils";
import { toast } from "sonner";
import { format } from "date-fns";

const criticalityColors = {
  critical: "bg-red-100 text-red-700",
  support: "bg-blue-100 text-blue-700",
  optional: "bg-slate-100 text-slate-700"
};

const videoTypeIcons = {
  overview: Video,
  step_by_step: CheckCircle2,
  troubleshooting: AlertCircle,
  update_changelog: History
};

export default function SOPView() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const urlParams = new URLSearchParams(window.location.search);
  const sopId = urlParams.get('id');

  const [showVideoForm, setShowVideoForm] = useState(false);
  const [showVerifyDialog, setShowVerifyDialog] = useState(false);
  const [showVersionHistory, setShowVersionHistory] = useState(false);

  const { data: sop } = useQuery({
    queryKey: ['sop', sopId],
    queryFn: () => dataClient.entities.SOP.filter({ id: sopId }).then(r => r[0]),
    enabled: !!sopId
  });

  const { data: role } = useQuery({
    queryKey: ['role', sop?.role_id],
    queryFn: () => dataClient.entities.Role.filter({ id: sop.role_id }).then(r => r[0]),
    enabled: !!sop?.role_id
  });

  const { data: videos = [] } = useQuery({
    queryKey: ['sopVideos', sopId],
    queryFn: () => dataClient.entities.SOPVideo.filter({ sop_id: sopId }),
    enabled: !!sopId
  });

  const { data: versions = [] } = useQuery({
    queryKey: ['sopVersions', sopId],
    queryFn: () => dataClient.entities.SOPVersion.filter({ sop_id: sopId }),
    enabled: !!sopId
  });

  const updateSopMutation = useMutation({
    mutationFn: ({ data }) => dataClient.entities.SOP.update(sopId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sop', sopId] });
      setShowVerifyDialog(false);
      toast.success("SOP verified!");
    }
  });

  const handleVerify = () => {
    updateSopMutation.mutate({
      data: {
        last_verified_date: new Date().toISOString().split('T')[0]
      }
    });
  };

  if (!sop) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-slate-500">Loading...</p>
      </div>
    );
  }

  const isStale = !sop.last_verified_date || 
    (new Date() - new Date(sop.last_verified_date)) / (1000 * 60 * 60 * 24) > 30;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto p-4 md:p-8">
        {/* Header */}
        <div className="flex items-center gap-4 mb-6">
          <Link to={createPageUrl("SOPLibrary")}>
            <Button variant="ghost" size="icon">
              <ArrowLeft className="w-4 h-4" />
            </Button>
          </Link>
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h1 className="text-2xl font-bold text-slate-900">{sop.title}</h1>
              {sop.supports_qbr && <Crown className="w-5 h-5 text-yellow-500" />}
            </div>
            {role && (
              <p className="text-slate-500">{role.name} • v{sop.version}</p>
            )}
          </div>
          <Link to={createPageUrl(`SOPEditor?id=${sopId}`)}>
            <Button>
              <Edit2 className="w-4 h-4 mr-2" /> Edit
            </Button>
          </Link>
        </div>

        {/* Status Banner */}
        {isStale && (
          <Card className="mb-6 bg-yellow-50 border-yellow-200">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Clock className="w-5 h-5 text-yellow-600" />
                  <span className="text-sm text-yellow-900">
                    This SOP hasn't been verified in 30+ days
                  </span>
                </div>
                <Button size="sm" onClick={() => setShowVerifyDialog(true)}>
                  Verify Now
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Metadata */}
        <Card className="mb-6">
          <CardContent className="p-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p className="text-xs text-slate-500 mb-1">Owner</p>
                <div className="flex items-center gap-1">
                  <User className="w-3 h-3 text-slate-400" />
                  <p className="text-sm font-medium">{sop.owner_email || 'Unassigned'}</p>
                </div>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Time</p>
                <p className="text-sm font-medium">{sop.time_expectation || 'Not specified'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Criticality</p>
                <Badge className={criticalityColors[sop.criticality]}>
                  {sop.criticality}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Last Verified</p>
                <p className="text-sm font-medium">
                  {sop.last_verified_date ? format(new Date(sop.last_verified_date), 'MMM d, yyyy') : 'Never'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Purpose */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Purpose</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-slate-700">{sop.purpose}</p>
            {sop.when_to_use && (
              <div className="mt-4 p-3 bg-blue-50 rounded-lg">
                <p className="text-sm text-blue-900">
                  <span className="font-semibold">When to use:</span> {sop.when_to_use}
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Videos */}
        {videos.length > 0 && (
          <Card className="mb-6">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Training Videos</CardTitle>
                <Button size="sm" onClick={() => setShowVideoForm(true)}>
                  <Plus className="w-4 h-4 mr-1" /> Add Video
                </Button>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              {videos.map(video => {
                const Icon = videoTypeIcons[video.video_type] || Video;
                return (
                  <div key={video.id} className="border border-slate-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <Icon className="w-5 h-5 text-[#0F9B8E] flex-shrink-0 mt-1" />
                      <div className="flex-1">
                        <h4 className="font-semibold text-slate-900 mb-1">{video.title}</h4>
                        <p className="text-xs text-slate-500 mb-2 capitalize">
                          {video.video_type.replace('_', ' ')} • {video.source}
                        </p>
                        <a 
                          href={video.video_url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-sm text-[#0F9B8E] hover:underline"
                        >
                          Watch Video →
                        </a>
                      </div>
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {!videos.length && (
          <Card className="mb-6 border-dashed">
            <CardContent className="p-8 text-center">
              <Video className="w-12 h-12 text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 mb-3">No training videos yet</p>
              <Button size="sm" onClick={() => setShowVideoForm(true)}>
                <Plus className="w-4 h-4 mr-1" /> Add First Video
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Steps */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-lg">Step-by-Step Instructions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {sop.steps?.map((step, index) => (
              <div key={index} className="flex gap-4">
                <div className="w-8 h-8 rounded-full bg-[#0F9B8E] text-white flex items-center justify-center text-sm font-semibold flex-shrink-0">
                  {step.step_number}
                </div>
                <div className="flex-1">
                  <p className="text-slate-900 mb-1">{step.instruction}</p>
                  {step.tips && (
                    <p className="text-sm text-slate-500 italic">💡 {step.tips}</p>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Additional Info */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {sop.common_mistakes && (
            <Card className="bg-red-50 border-red-200">
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-600" />
                  Common Mistakes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-red-900">{sop.common_mistakes}</p>
              </CardContent>
            </Card>
          )}

          {sop.tools?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Tools & Templates</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {sop.tools.map((tool, i) => (
                    <Badge key={i} variant="outline">{tool}</Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Version History */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Version History</CardTitle>
              <Button variant="ghost" size="sm" onClick={() => setShowVersionHistory(true)}>
                <History className="w-4 h-4 mr-1" /> View All
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-500">
              Current version: {sop.version} • {versions.length} total versions
            </p>
          </CardContent>
        </Card>

        {/* Dialogs */}
        {showVideoForm && (
          <VideoFormDialog 
            sopId={sopId}
            onClose={() => setShowVideoForm(false)}
          />
        )}

        {showVerifyDialog && (
          <VerifyDialog 
            onClose={() => setShowVerifyDialog(false)}
            onConfirm={handleVerify}
          />
        )}
      </div>
    </div>
  );
}

function VideoFormDialog({ sopId, onClose }) {
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState({
    title: "",
    video_type: "overview",
    source: "youtube",
    video_url: ""
  });

  const createMutation = useMutation({
    mutationFn: (data) => dataClient.entities.SOPVideo.create({
      ...data,
      sop_id: sopId
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sopVideos', sopId] });
      toast.success("Video added!");
      onClose();
    }
  });

  const handleSubmit = (e) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add Training Video</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label>Video Title</Label>
            <Input
              value={formData.title}
              onChange={(e) => setFormData({...formData, title: e.target.value})}
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Type</Label>
              <Select value={formData.video_type} onValueChange={(v) => setFormData({...formData, video_type: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="overview">Overview</SelectItem>
                  <SelectItem value="step_by_step">Step-by-step</SelectItem>
                  <SelectItem value="troubleshooting">Troubleshooting</SelectItem>
                  <SelectItem value="update_changelog">Update Log</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Source</Label>
              <Select value={formData.source} onValueChange={(v) => setFormData({...formData, source: v})}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="youtube">YouTube</SelectItem>
                  <SelectItem value="tiktok">TikTok</SelectItem>
                  <SelectItem value="vimeo">Vimeo</SelectItem>
                  <SelectItem value="internal_upload">Internal Upload</SelectItem>
                  <SelectItem value="external_link">External Link</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Video URL</Label>
            <Input
              type="url"
              value={formData.video_url}
              onChange={(e) => setFormData({...formData, video_url: e.target.value})}
              placeholder="https://..."
              required
            />
          </div>

          <div className="flex justify-end gap-3">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit">Add Video</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function VerifyDialog({ onClose, onConfirm }) {
  const [hasChanges, setHasChanges] = useState(null);

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Verify SOP</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            Did anything change from the SOP since you last used it?
          </p>

          <div className="space-y-2">
            <Button 
              variant="outline" 
              className="w-full justify-start"
              onClick={() => {
                onConfirm();
              }}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              No changes - SOP is still accurate
            </Button>
            <Button 
              variant="outline" 
              className="w-full justify-start"
              onClick={() => {
                toast.info("Please edit the SOP to update it");
                onClose();
              }}
            >
              <Edit2 className="w-4 h-4 mr-2" />
              Yes - I need to update the SOP
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
