"use client";

import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";

function TvViewerContent() {
  const searchParams = useSearchParams();
  const storeParam = searchParams.get("store")?.toUpperCase() || "ALL";
  const screenParam = parseInt(searchParams.get("screen") || "1");

  const [images, setImages] = useState<any[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [errorStatus, setErrorStatus] = useState<string | null>(null);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Función para obtener la hora actual en la zona de Los Angeles en formato HH:MM
  const getCurrentLATime = () => {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Los_Angeles",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23", // Use 00-23 format reliably
    });
    const parts = formatter.formatToParts(now);
    const hour = parts.find((p) => p.type === "hour")?.value || "00";
    const minute = parts.find((p) => p.type === "minute")?.value || "00";

    return `${hour}:${minute}`;
  };

  const fetchActiveMenu = useCallback(async () => {
    try {
      setLoading(true);
      const currentTime = getCurrentLATime();

      // 1. Encontrar la carpeta activa basándose en la hora
      const { data: folders, error: foldersError } = await supabase
        .from("tv_folders")
        .select("*");

      if (foldersError) throw foldersError;

      if (!folders || folders.length === 0) {
        setImages([]);
        setErrorStatus("No hay horarios configurados");
        setLoading(false);
        return;
      }

      // Buscar si alguna carpeta coincide con el horario actual
      let activeFolder = folders.find((f) => {
        const schedules = f.custom_schedules || [];

        // 1. Verify if this exact store has a custom schedule exception
        const customSchedule = schedules.find(
          (s: any) => s.store_id === storeParam,
        );

        if (customSchedule) {
          const start = customSchedule.start_time.substring(0, 5);
          const end = customSchedule.end_time.substring(0, 5);

          if (start > end) {
            return currentTime >= start || currentTime < end;
          }
          return currentTime >= start && currentTime < end;
        }

        // 2. If no custom exception, verify default schedule
        const start = f.start_time.substring(0, 5);
        const end = f.end_time.substring(0, 5);

        // Lógica para horarios que cruzan la medianoche (ej: 22:00 a 06:00)
        if (start > end) {
          return currentTime >= start || currentTime < end;
        }

        // Lógica normal (ej: 06:00 a 11:00)
        return currentTime >= start && currentTime < end;
      });

      if (!activeFolder) {
        setImages([]);
        setErrorStatus("No hay menús programados para esta hora");
        setLoading(false);
        return;
      }

      setErrorStatus(null);

      // 2. Obtener las imágenes de esa carpeta filtradas (quitamos filtro de tienda porque ya todas son UNIVERSALES para la carpeta)
      const { data: imgs, error: imgsError } = await supabase
        .from("tv_images")
        .select("*")
        .eq("folder_id", activeFolder.id)
        .eq("screen_number", screenParam)
        .order("sort_order", { ascending: true });

      if (imgsError) throw imgsError;

      setImages(imgs || []);
      setCurrentIndex(0);
    } catch (err) {
      console.error("Error fetching TV menu:", err);
      setErrorStatus("Error de conexión");
    } finally {
      setLoading(false);
    }
  }, [storeParam, screenParam]);

  // Verificar el horario activo y obtener datos iniciales periodicamente (cada 5 minutos) por si cambia el bloque
  useEffect(() => {
    fetchActiveMenu();
    const pollInterval = setInterval(fetchActiveMenu, 5 * 60 * 1000);
    return () => clearInterval(pollInterval);
  }, [fetchActiveMenu]);

  // Lógica de Supabase Realtime para actualización instantánea
  useEffect(() => {
    const channelFolders = supabase
      .channel("schema-db-changes-folders")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tv_folders" },
        () => {
          fetchActiveMenu();
        },
      )
      .subscribe();

    const channelImages = supabase
      .channel("schema-db-changes-images")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tv_images" },
        () => {
          fetchActiveMenu();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channelFolders);
      supabase.removeChannel(channelImages);
    };
  }, [fetchActiveMenu]);

  // Lógica de Rotación (Slideshow)
  useEffect(() => {
    if (images.length <= 1) return;

    const currentImage = images[currentIndex];
    const durationMs = (currentImage?.duration_seconds || 15) * 1000;

    timerRef.current = setTimeout(() => {
      setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length);
    }, durationMs);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [currentIndex, images]);

  if (loading && images.length === 0) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-16 h-16 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (images.length === 0) {
    return (
      <div className="min-h-screen bg-black flex flex-col items-center justify-center text-white">
        <h1 className="text-4xl font-black mb-4">TV Menús</h1>
        <p className="text-xl text-gray-400">
          {errorStatus || "Esperando imágenes..."}
        </p>
      </div>
    );
  }

  const activeImage = images[currentIndex];

  if (!activeImage) return null;

  return (
    <div className="min-h-screen w-full h-screen bg-black overflow-hidden m-0 p-0 fixed inset-0">
      <img
        key={activeImage.id}
        src={activeImage.storage_path}
        alt="Menu TV"
        className="w-full h-full object-contain animate-in fade-in duration-1000"
      />
    </div>
  );
}

export default function TvViewerPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-black flex items-center justify-center text-white">
          <p>Cargando parámetros de pantalla...</p>
        </div>
      }
    >
      <TvViewerContent />
    </Suspense>
  );
}
