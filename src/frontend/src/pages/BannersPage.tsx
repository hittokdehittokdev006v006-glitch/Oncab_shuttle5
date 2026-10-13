import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Eye,
  MousePointerClick,
  Plus,
  Trash2,
  Edit3,
  ExternalLink,
  Sparkles,
  Smartphone,
  Monitor,
  CheckCircle2,
  XCircle,
  UploadCloud,
  Layers,
  Link as LinkIcon,
  SlidersHorizontal,
  RefreshCw,
  Search,
  Filter,
  ArrowUpRight,
  Info,
} from 'lucide-react';
import { Card, Button, Input, Select, Modal, ConfirmDialog, Badge, StatusBadge, Table, Tr, Td, Pagination, LoadingState, EmptyState } from '../components/ui';
import { bannersAPI } from '../services/api';
import { Banner } from '../types';

interface BannersPageProps {
  onNotify: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

interface BannerStats {
  total: number;
  active: number;
  inactive: number;
  image_count: number;
  video_count: number;
  total_views: number;
  total_clicks: number;
}

interface BannerFormData {
  id?: number;
  title: string;
  subtitle: string;
  banner_type: 'image' | 'video';
  media_url: string;
  thumbnail_url: string;
  video_type: 'file' | 'youtube' | 'vimeo' | 'external_url';
  cta_title: string;
  cta_url: string;
  position: string;
  display_order: number;
  is_active: boolean;
  autoplay: boolean;
  is_muted: boolean;
  loop_video: boolean;
  show_controls: boolean;
}

const DEFAULT_FORM: BannerFormData = {
  title: '',
  subtitle: '',
  banner_type: 'image',
  media_url: '',
  thumbnail_url: '',
  video_type: 'file',
  cta_title: 'Explore Now',
  cta_url: '/trips',
  position: 'home_top',
  display_order: 1,
  is_active: true,
  autoplay: true,
  is_muted: true,
  loop_video: true,
  show_controls: true,
};

const SAMPLE_TEMPLATES = {
  image: {
    title: 'Daily Commute Made Easy - Flat 20% Off Monthly Passes',
    subtitle: 'Skip the surge prices and crowded trains. Reserved AC seat on premier routes starting at ₹49/ride.',
    banner_type: 'image' as const,
    media_url: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=1400&q=80',
    thumbnail_url: 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=600&q=80',
    video_type: 'file' as const,
    cta_title: 'Explore Passes',
    cta_url: '/passes',
    position: 'home_top',
    display_order: 1,
    is_active: true,
    autoplay: true,
    is_muted: true,
    loop_video: true,
    show_controls: true,
  },
  video: {
    title: 'Experience Oncab Executive Shuttle Service',
    subtitle: 'Direct business-class shuttles with guaranteed seating, high-speed Wi-Fi, and live GPS tracking.',
    banner_type: 'video' as const,
    media_url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
    thumbnail_url: 'https://images.unsplash.com/photo-1570125909232-eb263c188f7e?auto=format&fit=crop&w=1200&q=80',
    video_type: 'file' as const,
    cta_title: 'Book Your Seat',
    cta_url: '/trips',
    position: 'home_top',
    display_order: 2,
    is_active: true,
    autoplay: true,
    is_muted: true,
    loop_video: true,
    show_controls: true,
  },
};

export const BannersPage: React.FC<BannersPageProps> = ({ onNotify }) => {
  const [banners, setBanners] = useState<Banner[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [stats, setStats] = useState<BannerStats>({
    total: 0,
    active: 0,
    inactive: 0,
    image_count: 0,
    video_count: 0,
    total_views: 0,
    total_clicks: 0,
  });

  // Filters
  const [selectedType, setSelectedType] = useState<'all' | 'image' | 'video'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'true' | 'false'>('all');
  const [positionFilter, setPositionFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');

  // Pagination
  const [page, setPage] = useState<number>(1);
  const [totalPages, setTotalPages] = useState<number>(1);
  const [totalCount, setTotalCount] = useState<number>(0);
  const limit = 12;

  // Modal states
  const [modalOpen, setModalOpen] = useState<boolean>(false);
  const [isEditing, setIsEditing] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [formData, setFormData] = useState<BannerFormData>(DEFAULT_FORM);

  // File Upload states
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const [mediaInputMode, setMediaInputMode] = useState<'upload' | 'url'>('url');
  const [thumbInputMode, setThumbInputMode] = useState<'upload' | 'url'>('url');
  const [localMediaPreview, setLocalMediaPreview] = useState<string>('');
  const [localThumbPreview, setLocalThumbPreview] = useState<string>('');

  // Delete modal
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState<boolean>(false);
  const [bannerToDelete, setBannerToDelete] = useState<Banner | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Live Simulator / Preview modal
  const [simulatorOpen, setSimulatorOpen] = useState<boolean>(false);
  const [simBanner, setSimBanner] = useState<Banner | null>(null);
  const [simDevice, setSimDevice] = useState<'mobile' | 'desktop'>('mobile');

  // Video card audio states map
  const [mutedCardMap, setMutedCardMap] = useState<Record<number, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);

  // Fetch banners
  const fetchBanners = async () => {
    try {
      setLoading(true);
      const params: any = {
        page,
        limit,
      };
      if (selectedType !== 'all') params.type = selectedType;
      if (statusFilter !== 'all') params.is_active = statusFilter;
      if (positionFilter !== 'all') params.position = positionFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const resp = await bannersAPI.list(params);
      if (resp.data.success) {
        setBanners(resp.data.data || []);
        if (resp.data.stats) {
          setStats(resp.data.stats);
        }
        if (resp.data.pagination) {
          setTotalPages(resp.data.pagination.pages || 1);
          setTotalCount(resp.data.pagination.total || 0);
        }
      }
    } catch (err: any) {
      console.error('Failed to load banners:', err);
      onNotify(err.response?.data?.message || 'Failed to load banners', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchBanners();
  }, [page, selectedType, statusFilter, positionFilter, searchQuery]);

  // Open Create Modal
  const handleOpenCreate = (type: 'image' | 'video' = 'image') => {
    setIsEditing(false);
    setMediaFile(null);
    setThumbFile(null);
    setLocalMediaPreview('');
    setLocalThumbPreview('');
    setMediaInputMode('url');
    setThumbInputMode('url');

    // Pre-populate with beautiful starter template
    const template = SAMPLE_TEMPLATES[type];
    setFormData({
      ...DEFAULT_FORM,
      ...template,
      banner_type: type,
      display_order: banners.length + 1,
    });
    setModalOpen(true);
  };

  // Open Edit Modal
  const handleOpenEdit = (banner: Banner) => {
    setIsEditing(true);
    setMediaFile(null);
    setThumbFile(null);
    setLocalMediaPreview('');
    setLocalThumbPreview('');
    setMediaInputMode('url');
    setThumbInputMode('url');
    setFormData({
      id: banner.id,
      title: banner.title,
      subtitle: banner.subtitle || '',
      banner_type: banner.banner_type,
      media_url: banner.media_url,
      thumbnail_url: banner.thumbnail_url || '',
      video_type: banner.video_type || 'file',
      cta_title: banner.cta_title || '',
      cta_url: banner.cta_url || '',
      position: banner.position || 'home_top',
      display_order: banner.display_order ?? 0,
      is_active: banner.is_active,
      autoplay: banner.autoplay ?? true,
      is_muted: banner.is_muted ?? true,
      loop_video: banner.loop_video ?? true,
      show_controls: banner.show_controls ?? true,
    });
    setModalOpen(true);
  };

  // Handle media file selection
  const handleMediaFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setMediaFile(file);
      const url = URL.createObjectURL(file);
      setLocalMediaPreview(url);
    }
  };

  // Handle thumb file selection
  const handleThumbFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setThumbFile(file);
      const url = URL.createObjectURL(file);
      setLocalThumbPreview(url);
    }
  };

  // Submit banner form (supports multipart for files or JSON for URLs)
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.title.trim()) {
      onNotify('Banner title is required', 'error');
      return;
    }

    if (mediaInputMode === 'url' && !formData.media_url.trim()) {
      onNotify(`Please provide a ${formData.banner_type === 'video' ? 'video' : 'image'} URL`, 'error');
      return;
    }

    if (mediaInputMode === 'upload' && !mediaFile && !formData.media_url) {
      onNotify(`Please choose a ${formData.banner_type === 'video' ? 'video' : 'image'} file to upload`, 'error');
      return;
    }

    setSubmitting(true);
    try {
      let payload: any;
      if (mediaFile || thumbFile) {
        const fd = new FormData();
        fd.append('title', formData.title.trim());
        fd.append('subtitle', formData.subtitle.trim());
        fd.append('banner_type', formData.banner_type);
        fd.append('video_type', formData.video_type);
        fd.append('cta_title', formData.cta_title.trim());
        fd.append('cta_url', formData.cta_url.trim());
        fd.append('position', formData.position);
        fd.append('display_order', String(formData.display_order));
        fd.append('is_active', String(formData.is_active));
        fd.append('autoplay', String(formData.autoplay));
        fd.append('is_muted', String(formData.is_muted));
        fd.append('loop_video', String(formData.loop_video));
        fd.append('show_controls', String(formData.show_controls));

        if (mediaFile) {
          fd.append('media', mediaFile);
        } else {
          fd.append('media_url', formData.media_url);
        }

        if (thumbFile) {
          fd.append('thumbnail', thumbFile);
        } else if (formData.thumbnail_url) {
          fd.append('thumbnail_url', formData.thumbnail_url);
        }
        payload = fd;
      } else {
        payload = { ...formData };
      }

      if (isEditing && formData.id) {
        await bannersAPI.update(formData.id, payload);
        onNotify('Banner updated successfully!');
      } else {
        await bannersAPI.create(payload);
        onNotify('New banner created successfully!');
      }

      setModalOpen(false);
      fetchBanners();
    } catch (err: any) {
      console.error('Save banner error:', err);
      onNotify(err.response?.data?.message || 'Failed to save banner', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  // Toggle active status
  const handleToggleStatus = async (banner: Banner) => {
    try {
      const resp = await bannersAPI.toggleStatus(banner.id);
      if (resp.data.success) {
        setBanners((prev) =>
          prev.map((b) => (b.id === banner.id ? { ...b, is_active: !b.is_active } : b))
        );
        setStats((prev) => ({
          ...prev,
          active: banner.is_active ? prev.active - 1 : prev.active + 1,
          inactive: banner.is_active ? prev.inactive + 1 : prev.inactive - 1,
        }));
        onNotify(`Banner ${!banner.is_active ? 'activated' : 'deactivated'} successfully!`);
      }
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to update status', 'error');
    }
  };

  // Delete banner
  const handleDeleteConfirm = async () => {
    if (!bannerToDelete) return;
    setDeleting(true);
    try {
      await bannersAPI.delete(bannerToDelete.id);
      onNotify('Banner deleted successfully!');
      setDeleteConfirmOpen(false);
      setBannerToDelete(null);
      fetchBanners();
    } catch (err: any) {
      onNotify(err.response?.data?.message || 'Failed to delete banner', 'error');
    } finally {
      setDeleting(false);
    }
  };

  // Open device simulator
  const handleOpenSimulator = (banner: Banner) => {
    setSimBanner(banner);
    setSimulatorOpen(true);
  };

  // Toggle audio on card
  const toggleCardAudio = (id: number) => {
    setMutedCardMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Resolve media URL for rendering - supports absolute URLs, relative URLs, and subpath deployments (/bus-operator-dev/)
  const getDisplayMediaUrl = (banner: Banner) => {
    if (banner.media_full_url && /^https?:\/\//i.test(banner.media_full_url)) {
      return banner.media_full_url;
    }
    const target = banner.media_full_url || banner.media_url;
    if (!target) return '';
    if (/^https?:\/\//i.test(target)) return target;

    const clean = target.replace(/^\/+/, '');
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    if (pathname.includes('/bus-operator-dev')) {
      return `/bus-operator-dev/${clean}`;
    }
    return `/${clean}`;
  };

  const getDisplayThumbUrl = (banner: Banner) => {
    if (banner.thumbnail_full_url && /^https?:\/\//i.test(banner.thumbnail_full_url)) {
      return banner.thumbnail_full_url;
    }
    const target = banner.thumbnail_full_url || banner.thumbnail_url;
    if (!target) return '';
    if (/^https?:\/\//i.test(target)) return target;

    const clean = target.replace(/^\/+/, '');
    const pathname = typeof window !== 'undefined' ? window.location.pathname : '';
    if (pathname.includes('/bus-operator-dev')) {
      return `/bus-operator-dev/${clean}`;
    }
    return `/${clean}`;
  };

  // Computed CTR
  const overallCtr = stats.total_views > 0
    ? ((stats.total_clicks / stats.total_views) * 100).toFixed(1)
    : '0.0';

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12 animate-in fade-in duration-300">
      {/* ── Page Header ── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/80 dark:border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-md shadow-indigo-500/20">
              <Sparkles size={20} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                Banner Management
              </h1>
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Control customer-facing Image & Video promotional banners across mobile and web
              </p>
            </div>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenCreate('image')}
            icon={ImageIcon}
            className="hover:border-indigo-400 dark:hover:border-indigo-500 text-xs font-semibold"
          >
            + New Image Banner
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenCreate('video')}
            icon={VideoIcon}
            className="hover:border-purple-400 dark:hover:border-purple-500 text-xs font-semibold"
          >
            + New Video Banner
          </Button>

          <Button
            variant="primary"
            size="sm"
            onClick={() => handleOpenCreate('image')}
            icon={Plus}
            className="shadow-md shadow-indigo-500/25"
          >
            Create Banner
          </Button>
        </div>
      </div>

      {/* ── Top Analytics / Stat Cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3.5 sm:gap-4">
        {/* Total Banners */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 border-slate-800 text-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-400">Total Banners</span>
            <div className="w-8 h-8 rounded-lg bg-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Layers size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-extrabold text-white">{stats.total}</div>
          <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
            {stats.active} live in app
          </div>
        </Card>

        {/* Image Banners */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-sky-950/40 to-slate-900 border-sky-900/40 text-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-sky-400">Image Banners</span>
            <div className="w-8 h-8 rounded-lg bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <ImageIcon size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-extrabold text-sky-200">{stats.image_count}</div>
          <div className="text-xs text-slate-400 mt-1">High-impact static visuals</div>
        </Card>

        {/* Video Banners */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-purple-950/40 to-slate-900 border-purple-900/40 text-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-purple-400">Video Banners</span>
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 text-purple-400 flex items-center justify-center">
              <VideoIcon size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-extrabold text-purple-200">{stats.video_count}</div>
          <div className="text-xs text-slate-400 mt-1">Interactive autoplay reels</div>
        </Card>

        {/* Views Count */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-emerald-950/40 to-slate-900 border-emerald-900/40 text-white">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">Total Impressions</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Eye size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-extrabold text-emerald-200">{stats.total_views.toLocaleString()}</div>
          <div className="text-xs text-slate-400 mt-1">Passenger views recorded</div>
        </Card>

        {/* Clicks & CTR */}
        <Card className="relative overflow-hidden bg-gradient-to-br from-amber-950/40 to-slate-900 border-amber-900/40 text-white col-span-2 lg:col-span-1">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-400">Clicks / CTR</span>
            <div className="w-8 h-8 rounded-lg bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <MousePointerClick size={16} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-extrabold text-amber-200">
            {stats.total_clicks} <span className="text-xs text-amber-400/80 font-normal">({overallCtr}%)</span>
          </div>
          <div className="text-xs text-slate-400 mt-1">User CTA conversions</div>
        </Card>
      </div>

      {/* ── Filters & Controls Toolbar ── */}
      <Card className="p-4 bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          {/* Media Type Tabs */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800/80 p-1 rounded-xl w-fit">
            <button
              onClick={() => { setSelectedType('all'); setPage(1); }}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedType === 'all'
                  ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              All Banners ({stats.total})
            </button>
            <button
              onClick={() => { setSelectedType('image'); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedType === 'image'
                  ? 'bg-sky-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <ImageIcon size={13} />
              Image Banners ({stats.image_count})
            </button>
            <button
              onClick={() => { setSelectedType('video'); setPage(1); }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                selectedType === 'video'
                  ? 'bg-purple-600 text-white shadow-sm'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
              }`}
            >
              <VideoIcon size={13} />
              Video Banners ({stats.video_count})
            </button>
          </div>

          {/* Search & Dropdowns */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Search */}
            <div className="relative min-w-[200px] flex-1 sm:flex-initial">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search banners..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setPage(1); }}
                className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
              />
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={(e: any) => { setStatusFilter(e.target.value); setPage(1); }}
              className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="true">Active Only</option>
              <option value="false">Inactive Only</option>
            </select>

            {/* Position Filter */}
            <select
              value={positionFilter}
              onChange={(e) => { setPositionFilter(e.target.value); setPage(1); }}
              className="px-3 py-1.5 text-xs bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 rounded-xl text-slate-800 dark:text-slate-200 focus:outline-none"
            >
              <option value="all">All Positions</option>
              <option value="home_top">Home Top (Hero)</option>
              <option value="deals_slider">Deals Slider</option>
              <option value="popup_banner">Popup Banner</option>
              <option value="checkout_banner">Checkout Screen</option>
            </select>

            {/* View Mode Toggle */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
                title="Card Grid View"
              >
                <Layers size={14} />
              </button>
              <button
                onClick={() => setViewMode('table')}
                className={`p-1.5 rounded-md transition-all ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                }`}
                title="Table View"
              >
                <SlidersHorizontal size={14} />
              </button>
            </div>

            {/* Refresh */}
            <button
              onClick={fetchBanners}
              className="p-2 rounded-xl text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-white bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>
      </Card>

      {/* ── Banners Content ── */}
      {loading ? (
        <LoadingState message="Loading banners..." />
      ) : banners.length === 0 ? (
        <EmptyState
          message="No banners found"
          description={searchQuery ? 'Try adjusting your search or filters.' : 'Get started by creating your first promotional Image or Video banner!'}
          action={{
            label: 'Add Image Banner',
            onClick: () => handleOpenCreate('image'),
          }}
        />
      ) : viewMode === 'grid' ? (
        /* ── Grid View ── */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 xl:grid-cols-2 gap-6">
          {banners.map((banner) => {
            const isVideo = banner.banner_type === 'video';
            const isMuted = mutedCardMap[banner.id] ?? (banner.is_muted ?? true);
            const mediaUrl = getDisplayMediaUrl(banner);
            const thumbUrl = getDisplayThumbUrl(banner);

            return (
              <div
                key={banner.id}
                className={`group relative rounded-2xl overflow-hidden border transition-all duration-300 flex flex-col bg-white dark:bg-slate-900/90 shadow-sm hover:shadow-xl ${
                  banner.is_active
                    ? 'border-slate-200 dark:border-slate-800 hover:border-indigo-400 dark:hover:border-indigo-600/70'
                    : 'border-slate-200/60 dark:border-slate-800/50 opacity-75 grayscale-[20%]'
                }`}
              >
                {/* ── Card Media Header ── */}
                <div className="relative aspect-video w-full bg-slate-950 overflow-hidden flex items-center justify-center">
                  {isVideo ? (
                    <div className="relative w-full h-full">
                      <video
                        src={mediaUrl}
                        poster={thumbUrl || undefined}
                        autoPlay={banner.autoplay}
                        loop={banner.loop_video}
                        muted={isMuted}
                        playsInline
                        controls={banner.show_controls}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                      />
                      {/* Audio mute toggle overlay */}
                      <button
                        type="button"
                        onClick={() => toggleCardAudio(banner.id)}
                        className="absolute bottom-3 right-3 z-10 p-2 rounded-full bg-slate-900/80 hover:bg-slate-900 text-white backdrop-blur-md transition-all shadow-md"
                        title={isMuted ? 'Unmute Audio' : 'Mute Audio'}
                      >
                        {isMuted ? <VolumeX size={15} /> : <Volume2 size={15} className="text-emerald-400" />}
                      </button>
                    </div>
                  ) : (
                    <div className="relative w-full h-full overflow-hidden">
                      <img
                        src={mediaUrl}
                        alt={banner.title}
                        className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                        onError={(e: any) => {
                          if (!e.target.dataset.triedSubpath && banner.media_url?.startsWith('/uploads/')) {
                            e.target.dataset.triedSubpath = 'true';
                            e.target.src = `/bus-operator-dev${banner.media_url}`;
                            return;
                          }
                          e.target.src = 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=800&q=80';
                        }}
                      />
                      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent pointer-events-none" />
                    </div>
                  )}

                  {/* Badges on Media Overlay */}
                  <div className="absolute top-3 left-3 flex items-center gap-1.5 z-10">
                    <span
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold shadow-md uppercase tracking-wide backdrop-blur-md ${
                        isVideo
                          ? 'bg-purple-600/90 text-white ring-1 ring-purple-400/30'
                          : 'bg-sky-600/90 text-white ring-1 ring-sky-400/30'
                      }`}
                    >
                      {isVideo ? <VideoIcon size={12} /> : <ImageIcon size={12} />}
                      {banner.banner_type}
                    </span>

                    <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-900/80 text-slate-300 backdrop-blur-md ring-1 ring-white/10">
                      Order #{banner.display_order}
                    </span>
                  </div>

                  {/* Position Pill */}
                  <div className="absolute top-3 right-3 z-10">
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-indigo-950/80 text-indigo-300 border border-indigo-700/50 backdrop-blur-md uppercase tracking-wider">
                      {banner.position.replace('_', ' ')}
                    </span>
                  </div>
                </div>

                {/* ── Card Body ── */}
                <div className="p-5 flex-1 flex flex-col justify-between">
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base font-bold text-slate-900 dark:text-white line-clamp-1 group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                        {banner.title}
                      </h3>
                      {/* Active Status Badge */}
                      <button
                        onClick={() => handleToggleStatus(banner)}
                        className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer ${
                          banner.is_active
                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800/60'
                            : 'bg-slate-100 text-slate-600 border border-slate-300 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                        }`}
                        title="Click to toggle Active status"
                      >
                        <span
                          className={`w-1.5 h-1.5 rounded-full ${
                            banner.is_active ? 'bg-emerald-500 animate-pulse' : 'bg-slate-400'
                          }`}
                        />
                        {banner.is_active ? 'Active' : 'Inactive'}
                      </button>
                    </div>

                    {banner.subtitle && (
                      <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400 line-clamp-2 leading-relaxed">
                        {banner.subtitle}
                      </p>
                    )}

                    {/* CTA Pill & Link */}
                    {banner.cta_title && (
                      <div className="pt-2 flex items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-semibold bg-indigo-50 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800/50">
                          CTA: {banner.cta_title}
                          <ArrowUpRight size={13} />
                        </span>
                        {banner.cta_url && (
                          <span className="text-[11px] text-slate-500 font-mono truncate max-w-[180px]">
                            {banner.cta_url}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ── Analytics & Actions Footer ── */}
                  <div className="mt-5 pt-4 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
                    {/* View & Click Stats */}
                    <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400 font-medium">
                      <span className="flex items-center gap-1" title="Impressions">
                        <Eye size={13} className="text-slate-400" />
                        {banner.view_count || 0}
                      </span>
                      <span className="flex items-center gap-1" title="Clicks">
                        <MousePointerClick size={13} className="text-slate-400" />
                        {banner.click_count || 0}
                      </span>
                      {isVideo && (
                        <span className="text-[11px] text-purple-400 font-semibold">
                          {banner.autoplay ? 'Autoplay' : 'Manual'}
                        </span>
                      )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-1.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenSimulator(banner)}
                        icon={Smartphone}
                        className="text-xs text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 px-2.5"
                        title="Interactive Simulator Preview"
                      >
                        Preview
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleOpenEdit(banner)}
                        icon={Edit3}
                        className="text-xs text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 px-2.5"
                        title="Edit Banner"
                      >
                        Edit
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setBannerToDelete(banner);
                          setDeleteConfirmOpen(true);
                        }}
                        icon={Trash2}
                        className="text-xs text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 px-2.5"
                        title="Delete Banner"
                      >
                        Delete
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* ── Table View ── */
        <Card padding={false}>
          <Table
            headers={['Media', 'Title & Subtitle', 'Type', 'Position', 'Order', 'Stats', 'Status', 'Actions']}
            loading={loading}
            empty={banners.length === 0}
            emptyMessage="No banners matching the criteria."
          >
            {banners.map((banner) => {
              const isVideo = banner.banner_type === 'video';
              const mediaUrl = getDisplayMediaUrl(banner);
              return (
                <Tr key={banner.id}>
                  <Td>
                    <div className="w-16 h-10 rounded-lg overflow-hidden bg-slate-900 border border-slate-700 flex items-center justify-center relative">
                      {isVideo ? (
                        <div className="relative w-full h-full flex items-center justify-center bg-purple-950/60">
                          <Play size={16} className="text-purple-300" />
                        </div>
                      ) : (
                        <img
                          src={mediaUrl}
                          alt=""
                          className="w-full h-full object-cover"
                          onError={(e: any) => {
                            if (!e.target.dataset.triedSubpath && banner.media_url?.startsWith('/uploads/')) {
                              e.target.dataset.triedSubpath = 'true';
                              e.target.src = `/bus-operator-dev${banner.media_url}`;
                            }
                          }}
                        />
                      )}
                    </div>
                  </Td>
                  <Td>
                    <div className="max-w-md">
                      <p className="font-semibold text-slate-900 dark:text-white line-clamp-1">{banner.title}</p>
                      {banner.subtitle && (
                        <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1">{banner.subtitle}</p>
                      )}
                      {banner.cta_title && (
                        <span className="text-[10px] text-indigo-500 font-semibold">CTA: {banner.cta_title}</span>
                      )}
                    </div>
                  </Td>
                  <Td>
                    <Badge color={isVideo ? 'purple' : 'blue'}>
                      {isVideo ? 'Video' : 'Image'}
                    </Badge>
                  </Td>
                  <Td>
                    <span className="text-xs text-slate-600 dark:text-slate-300 capitalize">
                      {banner.position.replace('_', ' ')}
                    </span>
                  </Td>
                  <Td>
                    <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                      #{banner.display_order}
                    </span>
                  </Td>
                  <Td>
                    <div className="text-xs text-slate-600 dark:text-slate-400">
                      <div>{banner.view_count || 0} views</div>
                      <div className="text-slate-500">{banner.click_count || 0} clicks</div>
                    </div>
                  </Td>
                  <Td>
                    <button
                      onClick={() => handleToggleStatus(banner)}
                      className={`px-2 py-0.5 rounded-md text-xs font-semibold cursor-pointer ${
                        banner.is_active
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400'
                          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {banner.is_active ? 'Active' : 'Inactive'}
                    </button>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <Button variant="ghost" size="sm" onClick={() => handleOpenSimulator(banner)} icon={Smartphone} />
                      <Button variant="ghost" size="sm" onClick={() => handleOpenEdit(banner)} icon={Edit3} />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setBannerToDelete(banner);
                          setDeleteConfirmOpen(true);
                        }}
                        icon={Trash2}
                        className="text-rose-500"
                      />
                    </div>
                  </Td>
                </Tr>
              );
            })}
          </Table>

          {/* Pagination */}
          <Pagination
            page={page}
            pages={totalPages}
            total={totalCount}
            limit={limit}
            onPageChange={(p) => setPage(p)}
          />
        </Card>
      )}

      {/* ── Create / Edit Banner Modal ── */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={isEditing ? 'Edit Promotional Banner' : 'Create New Promotional Banner'}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setModalOpen(false)} disabled={submitting}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSubmit} loading={submitting}>
              {isEditing ? 'Save Changes' : 'Create Banner'}
            </Button>
          </>
        }
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* ── Banner Type Selector Tabs ── */}
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Banner Type <span className="text-rose-500">*</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  setFormData((prev) => ({
                    ...prev,
                    banner_type: 'image',
                    media_url: prev.banner_type === 'image' ? prev.media_url : SAMPLE_TEMPLATES.image.media_url,
                  }));
                }}
                className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all text-left ${
                  formData.banner_type === 'image'
                    ? 'border-indigo-600 bg-indigo-50/60 dark:bg-indigo-950/40 text-indigo-900 dark:text-indigo-200 ring-2 ring-indigo-500/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    formData.banner_type === 'image'
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  <ImageIcon size={18} />
                </div>
                <div>
                  <div className="font-bold text-sm">Image Banner</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">JPG, PNG, WebP or direct image URL</div>
                </div>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFormData((prev) => ({
                    ...prev,
                    banner_type: 'video',
                    media_url: prev.banner_type === 'video' ? prev.media_url : SAMPLE_TEMPLATES.video.media_url,
                    thumbnail_url: prev.thumbnail_url || SAMPLE_TEMPLATES.video.thumbnail_url,
                  }));
                }}
                className={`p-3.5 rounded-xl border flex items-center gap-3 transition-all text-left ${
                  formData.banner_type === 'video'
                    ? 'border-purple-600 bg-purple-50/60 dark:bg-purple-950/40 text-purple-900 dark:text-purple-200 ring-2 ring-purple-500/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300 dark:hover:border-slate-700'
                }`}
              >
                <div
                  className={`w-9 h-9 rounded-lg flex items-center justify-center ${
                    formData.banner_type === 'video'
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                  }`}
                >
                  <VideoIcon size={18} />
                </div>
                <div>
                  <div className="font-bold text-sm">Video Banner</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400">MP4, WebM video with autoplay & audio controls</div>
                </div>
              </button>
            </div>
          </div>

          {/* ── Media Source: Upload File OR Enter URL ── */}
          <div className="space-y-2 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700/80">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                {formData.banner_type === 'video' ? <VideoIcon size={14} className="text-purple-500" /> : <ImageIcon size={14} className="text-indigo-500" />}
                {formData.banner_type === 'video' ? 'Video Media Source' : 'Image Media Source'}
                <span className="text-rose-500">*</span>
              </label>

              {/* Toggle upload vs URL */}
              <div className="flex items-center bg-slate-200 dark:bg-slate-700/80 p-0.5 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setMediaInputMode('url')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                    mediaInputMode === 'url'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  URL Link
                </button>
                <button
                  type="button"
                  onClick={() => setMediaInputMode('upload')}
                  className={`px-2.5 py-1 rounded-md font-semibold transition-all ${
                    mediaInputMode === 'upload'
                      ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-400'
                  }`}
                >
                  Upload File
                </button>
              </div>
            </div>

            {mediaInputMode === 'url' ? (
              <div className="space-y-1">
                <Input
                  value={formData.media_url}
                  onChange={(v) => setFormData((prev) => ({ ...prev, media_url: v }))}
                  placeholder={
                    formData.banner_type === 'video'
                      ? 'https://example.com/video.mp4'
                      : 'https://example.com/banner.jpg'
                  }
                  required
                />
                <p className="text-[11px] text-slate-500 dark:text-slate-400">
                  Provide a direct HTTPS URL to an MP4/WebM video or image (e.g. Google Cloud, AWS S3, or CDN).
                </p>
              </div>
            ) : (
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={formData.banner_type === 'video' ? 'video/mp4,video/webm,video/ogg,video/quicktime' : 'image/*'}
                  onChange={handleMediaFileChange}
                  className="hidden"
                />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-300 dark:border-slate-700 hover:border-indigo-500 dark:hover:border-indigo-500 rounded-xl p-5 text-center cursor-pointer transition-all bg-white dark:bg-slate-900/60"
                >
                  <UploadCloud size={28} className="mx-auto text-indigo-500 mb-2" />
                  <p className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    {mediaFile ? mediaFile.name : `Click or drag & drop to upload ${formData.banner_type}`}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    {formData.banner_type === 'video'
                      ? 'MP4, WebM up to 50MB'
                      : 'JPG, PNG, WebP up to 10MB'}
                  </p>
                </div>
              </div>
            )}

            {/* If Video: Thumbnail / Poster Image */}
            {formData.banner_type === 'video' && (
              <div className="mt-3 pt-3 border-t border-slate-200/80 dark:border-slate-700/80 space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Video Poster / Thumbnail (Optional)
                  </label>
                  <div className="flex items-center bg-slate-200 dark:bg-slate-700/80 p-0.5 rounded-lg text-xs">
                    <button
                      type="button"
                      onClick={() => setThumbInputMode('url')}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        thumbInputMode === 'url' ? 'bg-white dark:bg-slate-900 text-white' : 'text-slate-400'
                      }`}
                    >
                      URL
                    </button>
                    <button
                      type="button"
                      onClick={() => setThumbInputMode('upload')}
                      className={`px-2 py-0.5 rounded text-[11px] font-semibold ${
                        thumbInputMode === 'upload' ? 'bg-white dark:bg-slate-900 text-white' : 'text-slate-400'
                      }`}
                    >
                      File
                    </button>
                  </div>
                </div>

                {thumbInputMode === 'url' ? (
                  <Input
                    value={formData.thumbnail_url}
                    onChange={(v) => setFormData((prev) => ({ ...prev, thumbnail_url: v }))}
                    placeholder="https://example.com/poster.jpg"
                  />
                ) : (
                  <div>
                    <input
                      ref={thumbInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleThumbFileChange}
                      className="hidden"
                    />
                    <div
                      onClick={() => thumbInputRef.current?.click()}
                      className="border border-dashed border-slate-300 dark:border-slate-700 rounded-lg p-2.5 text-center cursor-pointer text-xs text-slate-500"
                    >
                      {thumbFile ? thumbFile.name : 'Select poster image file'}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Video Specific Options ── */}
          {formData.banner_type === 'video' && (
            <div className="p-4 rounded-2xl bg-purple-50/50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/50 space-y-3">
              <div className="text-xs font-bold text-purple-900 dark:text-purple-300 flex items-center gap-1.5">
                <VideoIcon size={14} /> Video Playback Controls
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.autoplay}
                    onChange={(e) => setFormData((prev) => ({ ...prev, autoplay: e.target.checked }))}
                    className="rounded text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">Autoplay</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.is_muted}
                    onChange={(e) => setFormData((prev) => ({ ...prev, is_muted: e.target.checked }))}
                    className="rounded text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">Start Muted</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.loop_video}
                    onChange={(e) => setFormData((prev) => ({ ...prev, loop_video: e.target.checked }))}
                    className="rounded text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">Loop Video</span>
                </label>

                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formData.show_controls}
                    onChange={(e) => setFormData((prev) => ({ ...prev, show_controls: e.target.checked }))}
                    className="rounded text-purple-600 focus:ring-purple-500"
                  />
                  <span className="text-slate-700 dark:text-slate-300 font-medium">Controls Bar</span>
                </label>
              </div>
            </div>
          )}

          {/* ── Title & Subtitle ── */}
          <div className="space-y-3">
            <Input
              label="Banner Title"
              value={formData.title}
              onChange={(v) => setFormData((prev) => ({ ...prev, title: v }))}
              placeholder="e.g. Save 20% On Daily Office Commutes"
              required
            />

            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Subtitle / Promotional Text
              </label>
              <textarea
                value={formData.subtitle}
                onChange={(e) => setFormData((prev) => ({ ...prev, subtitle: e.target.value }))}
                placeholder="Short, catchy description for passengers..."
                rows={2}
                className="w-full px-3.5 py-2 rounded-xl text-sm transition-all bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20"
              />
            </div>
          </div>

          {/* ── Call To Action (CTA) & Destination Link ── */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Input
              label="CTA Button Text"
              value={formData.cta_title}
              onChange={(v) => setFormData((prev) => ({ ...prev, cta_title: v }))}
              placeholder="e.g. Book Seat, View Passes, Claim Deal"
            />

            <Input
              label="CTA Destination URL / Route"
              value={formData.cta_url}
              onChange={(v) => setFormData((prev) => ({ ...prev, cta_url: v }))}
              placeholder="e.g. /trips, /passes, https://..."
            />
          </div>

          {/* ── Position, Display Order, Active Status ── */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <div className="space-y-1.5">
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                Placement Position
              </label>
              <select
                value={formData.position}
                onChange={(e) => setFormData((prev) => ({ ...prev, position: e.target.value }))}
                className="w-full px-3 py-2 rounded-xl text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none"
              >
                <option value="home_top">Home Top (Hero)</option>
                <option value="deals_slider">Deals Slider</option>
                <option value="popup_banner">Popup Banner</option>
                <option value="checkout_banner">Checkout Screen</option>
              </select>
            </div>

            <Input
              label="Display Sequence Order"
              type="number"
              value={String(formData.display_order)}
              onChange={(v) => setFormData((prev) => ({ ...prev, display_order: parseInt(v, 10) || 0 }))}
              placeholder="1"
            />

            <div className="space-y-1.5 flex flex-col justify-end pb-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-700 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={formData.is_active}
                  onChange={(e) => setFormData((prev) => ({ ...prev, is_active: e.target.checked }))}
                  className="rounded text-indigo-600 focus:ring-indigo-500 w-4 h-4"
                />
                <span>Active & Visible to Passengers</span>
              </label>
            </div>
          </div>

          {/* ── Live In-Modal Preview Box ── */}
          {(localMediaPreview || formData.media_url) && (
            <div className="p-3.5 rounded-2xl bg-slate-950 text-white space-y-2 border border-slate-800">
              <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                <Eye size={12} /> Live Preview Rendering
              </div>
              <div className="relative rounded-xl overflow-hidden aspect-video bg-slate-900 flex items-center justify-center">
                {formData.banner_type === 'video' ? (
                  <video
                    src={localMediaPreview || formData.media_url}
                    poster={localThumbPreview || formData.thumbnail_url || undefined}
                    autoPlay
                    loop
                    muted
                    controls
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <img
                    src={localMediaPreview || formData.media_url}
                    alt="Preview"
                    className="w-full h-full object-cover"
                    onError={(e: any) => {
                      e.target.src = 'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=800&q=80';
                    }}
                  />
                )}
                {/* Simulated Overlay */}
                <div className="absolute inset-x-0 bottom-0 p-3 bg-gradient-to-t from-slate-950/90 via-slate-950/50 to-transparent flex items-center justify-between">
                  <div className="truncate pr-2">
                    <p className="font-bold text-xs truncate text-white">{formData.title || 'Banner Title'}</p>
                    <p className="text-[11px] text-slate-300 truncate">{formData.subtitle || 'Banner subtitle text'}</p>
                  </div>
                  {formData.cta_title && (
                    <span className="px-2.5 py-1 rounded bg-indigo-600 text-white font-bold text-[10px] shrink-0">
                      {formData.cta_title}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </form>
      </Modal>

      {/* ── Delete Confirmation Dialog ── */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onClose={() => setDeleteConfirmOpen(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete Banner"
        message={`Are you sure you want to delete "${bannerToDelete?.title}"? This banner will no longer appear on the passenger mobile app or website.`}
        confirmLabel="Yes, Delete Banner"
        variant="danger"
        loading={deleting}
      />

      {/* ── Interactive Passenger App Device Simulator Modal ── */}
      <Modal
        open={simulatorOpen}
        onClose={() => setSimulatorOpen(false)}
        title="Passenger App Live Preview Simulator"
        size="lg"
        footer={
          <div className="flex items-center justify-between w-full">
            <div className="text-xs text-slate-500 flex items-center gap-1.5">
              <Info size={13} />
              Testing live display for "{simBanner?.title}"
            </div>
            <Button variant="primary" onClick={() => setSimulatorOpen(false)}>
              Close Simulator
            </Button>
          </div>
        }
      >
        {simBanner && (
          <div className="flex flex-col items-center space-y-4">
            {/* Device Switcher */}
            <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
              <button
                onClick={() => setSimDevice('mobile')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  simDevice === 'mobile'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Smartphone size={14} /> Mobile App (iOS / Android)
              </button>
              <button
                onClick={() => setSimDevice('desktop')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                  simDevice === 'desktop'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Monitor size={14} /> Desktop Web Hero
              </button>
            </div>

            {/* Simulated Device Frame */}
            {simDevice === 'mobile' ? (
              /* Mobile Smartphone Frame */
              <div className="relative w-[340px] rounded-[40px] p-3.5 bg-slate-950 border-[6px] border-slate-800 shadow-2xl overflow-hidden ring-1 ring-white/10">
                {/* Notch */}
                <div className="absolute top-4 inset-x-0 mx-auto w-24 h-4 bg-slate-800 rounded-full z-30" />

                {/* Mobile Screen Container */}
                <div className="rounded-[30px] overflow-hidden bg-slate-900 text-white min-h-[520px] flex flex-col justify-between pt-7">
                  {/* Fake Passenger App Header */}
                  <div className="px-4 py-2 border-b border-slate-800/80 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] text-slate-400 uppercase font-semibold">City Shuttle</p>
                      <p className="text-xs font-bold text-white">Hello, Passenger 👋</p>
                    </div>
                    <div className="w-6 h-6 rounded-full bg-indigo-600 flex items-center justify-center text-[10px] font-bold">
                      OC
                    </div>
                  </div>

                  {/* App Search / Booking Bar */}
                  <div className="px-4 py-2.5">
                    <div className="p-2.5 rounded-xl bg-slate-800/90 border border-slate-700/60 flex items-center gap-2 text-xs text-slate-400">
                      <div className="w-2 h-2 rounded-full bg-emerald-400" />
                      <span>Where are you commuting today?</span>
                    </div>
                  </div>

                  {/* ── THE LIVE BANNER IN MOBILE APP ── */}
                  <div className="px-4 py-1 flex-1">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                      Promotions & Updates
                    </p>
                    <div className="relative rounded-2xl overflow-hidden bg-slate-950 border border-slate-700/80 shadow-lg group">
                      {simBanner.banner_type === 'video' ? (
                        <div className="relative aspect-[16/10] w-full">
                          <video
                            src={getDisplayMediaUrl(simBanner)}
                            poster={getDisplayThumbUrl(simBanner) || undefined}
                            autoPlay
                            loop
                            muted
                            playsInline
                            controls
                            className="w-full h-full object-cover"
                          />
                        </div>
                      ) : (
                        <div className="relative aspect-[16/10] w-full">
                          <img
                            src={getDisplayMediaUrl(simBanner)}
                            alt={simBanner.title}
                            className="w-full h-full object-cover"
                          />
                        </div>
                      )}

                      {/* Text & CTA Overlay on Banner */}
                      <div className="p-3 bg-slate-950/90 border-t border-slate-800 flex flex-col justify-between">
                        <div className="space-y-1">
                          <p className="font-bold text-xs text-white leading-tight">{simBanner.title}</p>
                          {simBanner.subtitle && (
                            <p className="text-[11px] text-slate-300 leading-snug line-clamp-2">
                              {simBanner.subtitle}
                            </p>
                          )}
                        </div>

                        {simBanner.cta_title && (
                          <div className="mt-2.5">
                            <button
                              type="button"
                              className="w-full py-1.5 px-3 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs shadow-md flex items-center justify-center gap-1"
                            >
                              {simBanner.cta_title}
                              <ArrowUpRight size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Fake Passenger App Bottom Nav */}
                  <div className="px-4 py-3 border-t border-slate-800/80 bg-slate-950/90 flex items-center justify-around text-[10px] text-slate-400 font-semibold">
                    <span className="text-indigo-400">Home</span>
                    <span>Routes</span>
                    <span>Passes</span>
                    <span>Account</span>
                  </div>
                </div>
              </div>
            ) : (
              /* Desktop Web Hero Banner Frame */
              <div className="w-full max-w-2xl rounded-2xl border border-slate-700 bg-slate-950 overflow-hidden shadow-2xl">
                <div className="px-4 py-2.5 bg-slate-900 border-b border-slate-800 flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-rose-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span className="text-xs font-mono text-slate-400 ml-2">oncab.in/passenger-portal</span>
                </div>

                <div className="relative aspect-[21/9] w-full bg-slate-950 flex items-center justify-center overflow-hidden">
                  {simBanner.banner_type === 'video' ? (
                    <video
                      src={getDisplayMediaUrl(simBanner)}
                      poster={getDisplayThumbUrl(simBanner) || undefined}
                      autoPlay
                      loop
                      muted
                      controls
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <img
                      src={getDisplayMediaUrl(simBanner)}
                      alt={simBanner.title}
                      className="w-full h-full object-cover"
                    />
                  )}

                  <div className="absolute inset-0 bg-gradient-to-r from-slate-950/90 via-slate-950/40 to-transparent p-6 flex flex-col justify-center max-w-sm pointer-events-none">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-400 mb-1">
                      Promotional Highlight
                    </span>
                    <h3 className="text-lg font-extrabold text-white leading-tight">{simBanner.title}</h3>
                    {simBanner.subtitle && (
                      <p className="text-xs text-slate-300 mt-1 line-clamp-2">{simBanner.subtitle}</p>
                    )}
                    {simBanner.cta_title && (
                      <div className="mt-3 pointer-events-auto">
                        <button className="px-3.5 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-indigo-600/30">
                          {simBanner.cta_title}
                          <ArrowUpRight size={13} />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};
