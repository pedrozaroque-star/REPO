"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  ShieldCheck,
  Plus,
  Clock,
  FileImage,
  Trash2,
  ChevronLeft,
  Calendar as CalendarIcon,
  Save,
  LockIcon,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import SurpriseLoader from "@/components/SurpriseLoader";
import ImageDropzone from "@/components/ui/ImageDropzone";
import {
  createFolderAction,
  deleteFolderAction,
  uploadImageAction,
  deleteImageAction,
} from "./actions";

export default function TvMenusAdminPage() {
  const [folders, setFolders] = useState<any[]>([]);
  const [images, setImages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeFolder, setActiveFolder] = useState<any | null>(null);
  const [customSchedules, setCustomSchedules] = useState<any[]>([]);

  // Assignment state
  const [uploadScreen, setUploadScreen] = useState(1);

  // Schedule Exceptions state
  const [exceptionStore, setExceptionStore] = useState("LYNWOOD");
  const [exceptionStart, setExceptionStart] = useState("06:00");
  const [exceptionEnd, setExceptionEnd] = useState("11:00");

  // Form state
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [newFolderStart, setNewFolderStart] = useState("06:00");
  const [newFolderEnd, setNewFolderEnd] = useState("11:00");

  // Auth state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const ADMIN_PASSWORD = "admin123";

  useEffect(() => {
    if (isAuthenticated) {
      fetchFolders();
    }
  }, [isAuthenticated]);

  useEffect(() => {
    if (activeFolder) {
      setCustomSchedules(activeFolder.custom_schedules || []);
      fetchImages(activeFolder.id);
    }
  }, [activeFolder]);

  const fetchFolders = async () => {
    try {
      const { data, error } = await supabase
        .from("tv_folders")
        .select("*")
        .order("start_time", { ascending: true });

      if (error) throw error;
      setFolders(data || []);
    } catch (err) {
      console.error("Error fetching folders:", err);
      alert("Error cargando los horarios");
    } finally {
      setLoading(false);
    }
  };

  const fetchImages = async (folderId: string) => {
    try {
      const { data, error } = await supabase
        .from("tv_images")
        .select("*")
        .eq("folder_id", folderId)
        .order("sort_order", { ascending: true });

      if (error) throw error;
      setImages(data || []);
    } catch (err) {
      console.error("Error fetching images:", err);
    }
  };

  const createFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const newFolder = await createFolderAction(
        newFolderName,
        newFolderStart,
        newFolderEnd,
      );
      setFolders(
        [...folders, newFolder].sort((a, b) =>
          a.start_time.localeCompare(b.start_time),
        ),
      );
      setShowNewFolder(false);
      setNewFolderName("");
    } catch (err) {
      console.error("Error creating folder:", err);
      alert("Error al crear el horario");
    }
  };

  const deleteFolder = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (
      !confirm("¿Seguro que deseas eliminar este horario y TODAS sus imágenes?")
    )
      return;

    try {
      await deleteFolderAction(id);
      setFolders(folders.filter((f) => f.id !== id));
    } catch (err) {
      console.error("Error deleting folder:", err);
      alert("Error al eliminar horario");
    }
  };

  const handleUploadImages = async (files: File[]) => {
    if (!activeFolder) return;

    let currentSort = images.length;

    for (const file of files) {
      try {
        const formData = new FormData();
        formData.append("file", file);

        await uploadImageAction(
          activeFolder.id,
          formData,
          currentSort,
          uploadScreen,
        );
        currentSort++;

        // Refresh images eagerly after each successful upload to give feedback
        await fetchImages(activeFolder.id);
      } catch (err) {
        console.error("Error uploading file:", err);
        alert("Hubo un error al subir alguna de las imágenes");
      }
    }
  };

  const deleteImage = async (id: string, storagePath: string) => {
    if (!confirm("¿Seguro que deseas eliminar esta imagen?")) return;

    try {
      await deleteImageAction(id, storagePath);
      setImages(images.filter((img) => img.id !== id));
    } catch (err) {
      console.error("Error deleting image:", err);
      alert("Error al eliminar imagen");
    }
  };

  const formatTime = (timeInfo: string) => {
    if (!timeInfo) return "";
    const [hours, minutes] = timeInfo.split(":");
    let h = parseInt(hours);
    const ampm = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    return `${h}:${minutes} ${ampm}`;
  };

  const addException = async () => {
    if (!activeFolder) return;
    const newSchedule = {
      store_id: exceptionStore,
      start_time: exceptionStart,
      end_time: exceptionEnd,
    };
    // check if store already exists to replace it, or add new
    const existing = customSchedules.filter(
      (s) => s.store_id !== exceptionStore,
    );
    const updated = [...existing, newSchedule];

    try {
      // we need to dynamically import or add updateFolderSchedulesAction to the import list
      const { updateFolderSchedulesAction } = await import("./actions");
      await updateFolderSchedulesAction(activeFolder.id, updated);
      setCustomSchedules(updated);
      // also update active folder in memory
      setActiveFolder({ ...activeFolder, custom_schedules: updated });
      // update in global list
      setFolders(
        folders.map((f) =>
          f.id === activeFolder.id
            ? { ...activeFolder, custom_schedules: updated }
            : f,
        ),
      );
    } catch (e) {
      alert("Error al guardar horario excepcional");
    }
  };

  const removeException = async (storeId: string) => {
    if (!activeFolder) return;
    const updated = customSchedules.filter((s) => s.store_id !== storeId);

    try {
      const { updateFolderSchedulesAction } = await import("./actions");
      await updateFolderSchedulesAction(activeFolder.id, updated);
      setCustomSchedules(updated);
      setActiveFolder({ ...activeFolder, custom_schedules: updated });
      setFolders(
        folders.map((f) =>
          f.id === activeFolder.id
            ? { ...activeFolder, custom_schedules: updated }
            : f,
        ),
      );
    } catch (e) {
      alert("Error al eliminar horario excepcional");
    }
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (password === ADMIN_PASSWORD) {
      setIsAuthenticated(true);
    } else {
      alert("Contraseña incorrecta");
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-neutral-900 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 opacity-40 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl p-8 w-full max-w-md border border-gray-100 dark:border-slate-800 relative z-10"
        >
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-full flex items-center justify-center mx-auto mb-4 text-indigo-600 dark:text-indigo-400">
              <LockIcon size={40} />
            </div>
            <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-1">
              Menús Digitales TV
            </h1>
            <p className="text-gray-500 dark:text-slate-400 font-medium tracking-tight">
              Acceso Restringido
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label
                htmlFor="password"
                className="block text-[10px] font-black text-gray-400 dark:text-slate-500 uppercase tracking-[0.2em] mb-3"
              >
                Contraseña
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3.5 bg-gray-50 dark:bg-slate-800 border border-gray-100 dark:border-slate-700 rounded-2xl text-gray-900 dark:text-white font-bold focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-500 outline-none transition-all"
                placeholder="••••••••"
                required
              />
            </div>

            <button
              type="submit"
              className="w-full bg-gray-900 dark:bg-slate-100 dark:text-slate-900 text-white font-black py-4 rounded-2xl transition-all active:scale-[0.98] shadow-xl shadow-gray-200 dark:shadow-none uppercase tracking-widest"
            >
              INGRESAR
            </button>
          </form>
        </motion.div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-transparent dark:bg-neutral-900 flex items-center justify-center p-4 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>
        <SurpriseLoader />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-transparent dark:bg-neutral-900 font-sans pt-20 lg:pt-0 relative">
      <div className="absolute inset-0 opacity-10 dark:opacity-40 pointer-events-none bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

      {/* HEADER */}
      <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-gray-200 dark:border-slate-800 shadow-sm sticky top-14 lg:top-0 z-20 shrink-0 transition-all">
        <div className="max-w-7xl mx-auto px-4 md:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl bg-indigo-100 dark:bg-indigo-900/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400">
              <ShieldCheck size={18} />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-black text-gray-900 dark:text-white tracking-tight leading-none">
                Menús Digitales TV
              </h1>
              <p className="hidden md:block text-[10px] text-gray-400 dark:text-slate-500 font-bold uppercase tracking-wider">
                Gestión de Publicidad en Sucursales
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 md:px-8 py-8 pb-24 relative z-10">
        <AnimatePresence mode="wait">
          {!activeFolder ? (
            <motion.div
              key="folders"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-6"
            >
              <div className="flex justify-between items-center mb-6">
                <div>
                  <h2 className="text-2xl font-black text-gray-900 dark:text-white">
                    Horarios (Carpetas)
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    Crea los bloques de horario para mostrar diferentes menús.
                  </p>
                </div>
                {!showNewFolder && (
                  <button
                    onClick={() => setShowNewFolder(true)}
                    className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-md shadow-indigo-500/20"
                  >
                    <Plus size={18} />
                    <span>Nuevo Horario</span>
                  </button>
                )}
              </div>

              {/* Formulario nuevo horario */}
              {showNewFolder && (
                <motion.form
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  onSubmit={createFolder}
                  className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm mb-6"
                >
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                    <div>
                      <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                        Nombre del Evento
                      </label>
                      <input
                        required
                        type="text"
                        placeholder="Ej: Desayuno, Almuerzo..."
                        value={newFolderName}
                        onChange={(e) => setNewFolderName(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                        Hora de Inicio
                      </label>
                      <input
                        required
                        type="time"
                        value={newFolderStart}
                        onChange={(e) => setNewFolderStart(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                        Hora de Fin
                      </label>
                      <input
                        required
                        type="time"
                        value={newFolderEnd}
                        onChange={(e) => setNewFolderEnd(e.target.value)}
                        className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-indigo-500/50"
                      />
                    </div>
                  </div>
                  <div className="flex gap-3 justify-end">
                    <button
                      type="button"
                      onClick={() => setShowNewFolder(false)}
                      className="px-5 py-2.5 rounded-xl font-bold text-gray-600 dark:text-slate-300 hover:bg-gray-100 dark:hover:bg-slate-700 transition-colors"
                    >
                      Cancelar
                    </button>
                    <button
                      type="submit"
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl font-bold transition-all shadow-md shadow-indigo-500/20"
                    >
                      <Save size={18} /> Guardar
                    </button>
                  </div>
                </motion.form>
              )}

              {/* Lista de Carpetas */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {folders.length === 0 && !showNewFolder && (
                  <div className="col-span-full py-20 text-center opacity-60">
                    <CalendarIcon
                      size={48}
                      className="mx-auto mb-4 text-gray-400"
                    />
                    <p className="text-xl font-bold text-gray-700 dark:text-slate-300">
                      No hay horarios creados
                    </p>
                    <p className="text-sm">
                      Comienza creando un horario para subir imágenes.
                    </p>
                  </div>
                )}
                {folders.map((folder) => (
                  <div
                    key={folder.id}
                    onClick={() => setActiveFolder(folder)}
                    className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm hover:shadow-md cursor-pointer transition-all hover:scale-[1.02] group"
                  >
                    <div className="flex justify-between items-start mb-4">
                      <div className="w-12 h-12 bg-indigo-50 dark:bg-indigo-900/30 rounded-2xl flex items-center justify-center text-indigo-500">
                        <FileImage size={24} />
                      </div>
                      <button
                        onClick={(e) => deleteFolder(folder.id, e)}
                        className="p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Eliminar Horario"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>

                    <h3 className="text-xl font-black text-gray-900 dark:text-white mb-1">
                      {folder.name}
                    </h3>
                    <div className="flex items-center gap-2 text-sm font-semibold text-gray-500 dark:text-slate-400 bg-gray-50 dark:bg-slate-900 w-fit px-3 py-1.5 rounded-lg border border-gray-100 dark:border-slate-700">
                      <Clock size={14} className="text-indigo-500" />
                      <span>
                        {formatTime(folder.start_time)} -{" "}
                        {formatTime(folder.end_time)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          ) : (
            <motion.div
              key="images"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="space-y-6"
            >
              <div className="flex items-center gap-4 mb-6">
                <button
                  onClick={() => {
                    setActiveFolder(null);
                    setImages([]);
                  }}
                  className="p-2 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-gray-100 dark:border-slate-700 text-gray-600 dark:text-slate-300 hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                >
                  <ChevronLeft size={24} />
                </button>
                <div>
                  <h2 className="text-2xl font-black text-gray-900 dark:text-white flex items-center gap-3">
                    {activeFolder.name}
                    <span className="text-xs font-bold uppercase tracking-widest bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-400 px-3 py-1 rounded-full border border-indigo-200 dark:border-indigo-800/50">
                      {formatTime(activeFolder.start_time)} -{" "}
                      {formatTime(activeFolder.end_time)}
                    </span>
                  </h2>
                  <p className="text-sm text-gray-500 dark:text-slate-400">
                    Las TVs mostrarán estas imágenes durante este horario.
                  </p>
                </div>
              </div>

              {/* Ajustes de Horarios Excepcionales por Sucursal */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm mb-6">
                <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider mb-4 border-b border-gray-100 dark:border-slate-700 pb-2">
                  Horarios Diferentes por Sucursal (Opcional)
                </h3>

                {customSchedules.length > 0 && (
                  <div className="mb-4 space-y-2">
                    {customSchedules.map((s: any, idx: number) => (
                      <div
                        key={idx}
                        className="flex justify-between items-center bg-gray-50 dark:bg-slate-900 px-4 py-2 rounded-xl text-sm font-semibold"
                      >
                        <span>{s.store_id}</span>
                        <div className="flex items-center gap-4">
                          <span className="text-indigo-600 dark:text-indigo-400">
                            {formatTime(s.start_time)} -{" "}
                            {formatTime(s.end_time)}
                          </span>
                          <button
                            onClick={() => removeException(s.store_id)}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex flex-col md:flex-row gap-4 items-end">
                  <div className="flex-1">
                    <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                      Sucursal
                    </label>
                    <select
                      value={exceptionStore}
                      onChange={(e) => setExceptionStore(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-indigo-500/50"
                    >
                      <option value="AZUSA">Azusa</option>
                      <option value="BELL">Bell</option>
                      <option value="DOWNEY">Downey</option>
                      <option value="HOLLYWOOD">Hollywood</option>
                      <option value="HUNTINGTON PARK">Huntington Park</option>
                      <option value="LA BROADWAY">LA Broadway</option>
                      <option value="LA CENTRAL">LA Central</option>
                      <option value="LA PUENTE">La Puente</option>
                      <option value="LYNWOOD">Lynwood</option>
                      <option value="NORWALK">Norwalk</option>
                      <option value="RIALTO">Rialto</option>
                      <option value="SANTA ANA">Santa Ana</option>
                      <option value="SLAUSON">Slauson</option>
                      <option value="SOUTH GATE">South Gate</option>
                      <option value="WEST COVINA">West Covina</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                      Inicio
                    </label>
                    <input
                      type="time"
                      value={exceptionStart}
                      onChange={(e) => setExceptionStart(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                      Fin
                    </label>
                    <input
                      type="time"
                      value={exceptionEnd}
                      onChange={(e) => setExceptionEnd(e.target.value)}
                      className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-indigo-500/50"
                    />
                  </div>
                  <button
                    onClick={addException}
                    className="h-[46px] px-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold transition-all shadow-md shadow-indigo-500/20"
                  >
                    Añadir
                  </button>
                </div>
              </div>

              {/* Ajustes de Asignación */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm mb-6 flex flex-col md:flex-row gap-4">
                <div className="flex-1 flex flex-col justify-center">
                  <h3 className="text-sm font-black text-gray-900 dark:text-white uppercase tracking-wider mb-1">
                    Subir Nuevas Imágenes
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-slate-400">
                    Selecciona a qué número de televisión quieres enviar las
                    siguientes imágenes. Estas se mostrarán en TODAS las
                    sucursales según sus horarios.
                  </p>
                </div>
                <div className="w-full md:w-64">
                  <label className="block text-xs font-bold text-gray-500 dark:text-slate-400 uppercase tracking-wider mb-2">
                    En la Pantalla (TV N°)
                  </label>
                  <select
                    value={uploadScreen}
                    onChange={(e) => setUploadScreen(Number(e.target.value))}
                    className="w-full bg-gray-50 dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded-xl px-4 py-3 text-gray-900 dark:text-white font-semibold outline-none focus:ring-2 focus:ring-indigo-500/50"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                      <option key={num} value={num}>
                        TV {num}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Uploader */}
              <div className="bg-white dark:bg-slate-800 p-6 rounded-3xl border border-gray-100 dark:border-slate-700 shadow-sm">
                <ImageDropzone onUpload={handleUploadImages} />
              </div>

              {/* Grid de Imágenes */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 mt-8">
                {images.length === 0 && (
                  <div className="col-span-full py-10 text-center text-gray-500 dark:text-slate-400 font-bold">
                    No hay imágenes en este horario. ¡Sube la primera!
                  </div>
                )}
                {images.map((img, index) => (
                  <div
                    key={img.id}
                    className="group relative bg-white dark:bg-slate-800 rounded-2xl overflow-hidden border border-gray-200 dark:border-slate-700 shadow-sm hover:shadow-lg transition-all"
                  >
                    <div className="aspect-video w-full bg-gray-100 dark:bg-slate-900 relative">
                      <img
                        src={img.storage_path}
                        alt="TV Menu"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col items-center justify-center gap-3">
                        <button
                          onClick={() => deleteImage(img.id, img.storage_path)}
                          className="bg-red-500 hover:bg-red-600 text-white p-3 rounded-full flex items-center justify-center shadow-lg transform transition-transform hover:scale-110"
                        >
                          <Trash2 size={20} />
                        </button>
                        <span className="text-white text-xs font-bold uppercase tracking-widest drop-shadow-md">
                          Eliminar
                        </span>
                      </div>
                    </div>
                    <div className="p-3 bg-gray-50 dark:bg-slate-800/80 border-t border-gray-100 dark:border-slate-700 flex flex-col gap-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[10px] font-black tracking-widest text-indigo-600 dark:text-indigo-400 uppercase">
                          UNIVERSAL
                        </span>
                        <span className="text-[10px] font-black tracking-widest text-white bg-slate-800 px-2 py-0.5 rounded-md">
                          TV {img.screen_number || 1}
                        </span>
                      </div>
                      <div className="flex justify-between items-center opacity-50">
                        <span className="text-[10px] font-bold text-gray-500 dark:text-slate-400">
                          Ord: {index + 1}
                        </span>
                        <span className="text-[10px] font-bold text-gray-500 dark:text-slate-400">
                          {img.duration_seconds}s
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
