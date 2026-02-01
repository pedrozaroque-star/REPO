
export const SUPERVISOR_TRANSLATIONS: Record<string, { en: string }> = {
    // SERVICE
    "Saluda y despide cordialmente": { en: "Greets and says goodbye cordially" },
    "Atiende con paciencia y respeto": { en: "Serves with patience and respect" },
    "Entrega órdenes con frase de cierre": { en: "Delivers orders with closing phrase" },
    "Evita charlas personales en línea": { en: "Avoids personal chats on the line" },

    // MEATS
    "Controla temperatura (450°/300°) y tiempos": { en: "Controls temperature (450°/300°) and times" },
    "Utensilios limpios, no golpear espátulas": { en: "Utensils clean, no banging spatulas" },
    "Escurre carnes y rota producto (FIFO)": { en: "Drains meats and rotates product (FIFO)" },
    "Vigila cebolla asada y porciones": { en: "Monitors grilled onions and portions" },

    // FOOD PREP
    "Respeta porciones estándar (cucharas)": { en: "Respects standard portions (spoons)" },
    "Quesadillas bien calientes, sin quemar": { en: "Quesadillas hot, not burnt" },
    "Burritos bien enrollados, sin dorar de más": { en: "Burritos well rolled, not over-toasted" },
    "Stickers correctos donde aplica": { en: "Correct stickers where applicable" },

    // TORTILLAS
    "Tortillas bien calientes (aceite solo en orillas)": { en: "Tortillas hot (oil only on edges)" },
    "Máx 5 tacos por plato (presentación)": { en: "Max 5 tacos per plate (presentation)" },
    "Reponer a tiempo y mantener frescura": { en: "Restock on time and maintain freshness" },

    // CLEANING
    "Cubetas rojas con sanitizer tibio": { en: "Red buckets with warm sanitizer" },
    "Plancha limpia y sin residuos": { en: "Grill clean and residue-free" },
    "Baños con insumos completos y sin olores": { en: "Bathrooms stocked and odor-free" },
    "Exterior y basureros limpios": { en: "Exterior and dumpsters clean" },

    // LOGS
    "Checklist apertura/cierre completo": { en: "Opening/Closing checklist complete" },
    "Bitácora de temperaturas al día": { en: "Temperature log up to date" },
    "Registros de limpieza firmados": { en: "Cleaning logs signed" },

    // GROOMING
    "Uniforme limpio y completo": { en: "Uniform clean and complete" },
    "Uñas cortas, sin joyas/auriculares": { en: "Nails short, no jewelry/headphones" },
    "Uso correcto de gorra y guantes": { en: "Correct use of hat and gloves" },

    // SECTIONS (Titles)
    "Servicio al Cliente": { en: "Customer Service" },
    "Procedimiento de Carnes": { en: "Meat Procedures" },
    "Preparación de Alimentos": { en: "Food Preparation" },
    "Seguimiento a Tortillas": { en: "Tortilla Monitoring" },
    "Limpieza General y Baños": { en: "General Cleaning & Bathrooms" },
    "Checklists y Bitácoras": { en: "Checklists & Logs" },
    "Aseo Personal": { en: "Personal Grooming" },

    // MANAGER CHECKLIST SPECIFIC
    "COCINA Y LÍNEA DE PREPARACIÓN": { en: "Kitchen & Prep Line" },
    "No hay basura ni aceite debajo de las parrillas y equipos": { en: "No trash or oil under grills and equipment" },
    "Todos los productos están a la temperatura adecuada": { en: "All products are at the proper temperature" },
    "Los protectores contra estornudos están limpios (huellas, etc.)": { en: "Sneeze guards are clean (fingerprints, etc.)" },
    "Pisos limpios y secos (incluyendo esquinas y desagües)": { en: "Floors clean and dry (including corners and drains)" },
    "Botes de basura limpios y con bolsa": { en: "Trash cans clean and lined" },
    "Utensilios limpios y organizados": { en: "Utensils clean and organized" }
}

export function getTranslatedSupervisor(text: string, lang: 'es' | 'en'): string {
    if (lang === 'es') return text
    // Normalize keys slightly to handle varied casing if needed, but strict map is faster first
    return SUPERVISOR_TRANSLATIONS[text]?.en || text
}
