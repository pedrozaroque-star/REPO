export interface Store {
  id: number; // bigint en DB
  code: string | null;
  name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  phone: string | null;
  email: string | null;
  supervisor_name: string | null;
  latitude: number | null;
  longitude: number | null;
}

export interface User {
  id: number; // bigint en DB
  email: string | null;
  full_name: string | null;
  role: 'admin' | 'manager' | 'cajero' | 'cocinero' | string; // Ajustable según tus roles
  store_scope: number[] | null; // Es un ARRAY en DB
  phone: string | null;
  avatar_url: string | null;
  is_active: boolean;
  last_login: string | null; // timestamp
  created_at: string;
}

export interface AssistantChecklist {
  id: number;
  user_id: number | null;
  store_id: number | null;
  assistant_name: string | null;
  checklist_type: 'apertura' | 'cierre' | 'daily' | 'recorrido' | string;
  shift: string | null;
  checklist_date: string; // date
  start_time: string | null; // time
  end_time: string | null; // time
  answers: Record<string, any>; // JSONB: Aquí guardas las respuestas dinámicas
  score: number | null;
  photo_urls: string[] | null; // ARRAY
  comments: string | null;
  
  // Revisión del Manager
  estatus_manager: string | null;
  reviso_manager: string | null;
  fecha_revision_manager: string | null;
  comentarios_manager: string | null;
  
  created_at: string;
}

export interface CustomerFeedback {
  id: number;
  visit_date: string | null; // date
  store_code: string | null; // Posible relación manual
  order_type: string | null;
  
  nps_score: number | null;
  nps_category: string | null; // Promoter, Passive, Detractor
  speed_rating: number | null;
  
  complaint_type: string | null;
  comments: string | null;
  photo_urls: string[] | null;
  
  customer_name: string | null;
  customer_email: string | null;
  customer_phone: string | null;
  
  requires_follow_up: boolean; // Inferido del contexto, aunque no lo vi explícito en el snippet corto
  follow_up_notes: string | null;
  created_at: string;
}

export interface SupervisorInspection {
  id: number;
  inspector_id: number | null;
  store_id: number | null;
  inspection_date: string;
  
  // Puntajes por categoría
  overall_score: number | null;
  limpieza_score: number | null;
  servicio_score: number | null;
  alimentos_score: number | null;
  carnes_score: number | null;
  tortillas_score: number | null;
  aseo_score: number | null;
  bitacoras_score: number | null;
  
  observaciones: string | null;
  photos_drive_folder: string | null;
  photos_count: number | null;
  
  created_at: string;
}