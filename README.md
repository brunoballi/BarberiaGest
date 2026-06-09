# 💈 VALHALLA - Sistema de Gestión para Barberías

**VALHALLA** es un sistema web integral de gestión diseñado para barberías. Permite administrar operaciones diarias, liquidaciones automáticas, control financiero y reportes detallados.

## 🎯 Características Principales

✅ **Registro de Transacciones** - Control en tiempo real de ventas  
✅ **Liquidaciones Automáticas** - Cálculo de comisiones por barbero  
✅ **Multi-Sucursal** - Gestión de múltiples locales  
✅ **Control de Gastos** - Categorización y análisis  
✅ **Sistema de Adelantos** - Anticipos a barberos  
✅ **Bonos y Beneficios** - Presentismo y objetivos  
✅ **Reportes Financieros** - Análisis de rentabilidad  
✅ **Auditoría Completa** - Trazabilidad de cambios  
✅ **Autenticación Segura** - Sistema de login con Supabase  

## 🚀 Stack Tecnológico

- **Frontend:** Next.js 16 + React 19 + TypeScript + Tailwind CSS 4
- **Backend:** Supabase (PostgreSQL + Realtime)
- **Auth:** Supabase Auth (Email + Password)
- **Deploy:** Vercel (CI/CD Automático)
- **Database:** PostgreSQL (Supabase)

## 📖 DOCUMENTACIÓN

Encontrarás dos documentos completos en la raíz del proyecto:

### 1. 📘 **DOCUMENTACION_FORMAL.md**
Documentación técnica y funcional detallada:
- Arquitectura del sistema
- Descripción de cada módulo
- Flujo de operaciones
- Características avanzadas
- Beneficios entregados

**Ideal para:** Presentaciones, evaluación de precio, análisis técnico

### 2. 📗 **GUIA_DE_USUARIO.md**
Guía práctica paso a paso para usar el sistema:
- Cómo acceder y navegar
- Registro de transacciones
- Gestión de barberos
- Procesamiento de liquidaciones
- Casos de uso comunes
- Preguntas frecuentes
- Solución de problemas

**Ideal para:** El cliente final, capacitación, uso diario

## 🎮 Primeros Pasos

### Requisitos
- Node.js 18+
- npm o yarn
- Acceso a Supabase (ya configurado)

### Instalación

```bash
# Clonar el repositorio
git clone <repo-url>
cd sistema_gestion_barberias

# Instalar dependencias
npm install

# Configurar variables de entorno
# Copia .env.example a .env.local y completa:
cp .env.example .env.local
```

### Variables de Entorno
```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=xxxxx
SUPABASE_SERVICE_ROLE_KEY=xxxxx
```

### Desarrollo Local

```bash
# Iniciar servidor de desarrollo
npm run dev
```

Abre [http://localhost:3000](http://localhost:3000) en tu navegador.

**Credenciales demo:**
- Email: `brunoballinari@gmail.com`
- Contraseña: [ver archivo de configuración]

### Build para Producción

```bash
# Build
npm run build

# Iniciar servidor
npm start
```

## 📁 Estructura del Proyecto

```
sistema_gestion_barberias/
├── app/
│   ├── admin/
│   │   ├── page.tsx (Dashboard principal)
│   │   ├── barberos/ (Gestión de barberos)
│   │   ├── admins/ (Gestión de administradores)
│   │   ├── servicios/ (Catálogo de servicios)
│   │   ├── semanas/ (Períodos de liquidación)
│   │   ├── beneficios/ (Bonos y beneficios)
│   │   ├── reportes/ (Reportes financieros)
│   │   ├── auditoria/ (Registro de cambios)
│   │   ├── configuracion/ (Parámetros globales)
│   │   └── select-branch/ (Selección de sucursal)
│   ├── barber/ (Dashboard para barberos)
│   ├── login/ (Autenticación)
│   ├── components/ (Componentes reutilizables)
│   └── layout.tsx
├── lib/
│   ├── supabase/
│   │   ├── supabase.client.ts (Cliente Supabase)
│   │   ├── database.types.ts (Tipos TypeScript)
│   │   └── migrations/ (Migraciones SQL)
│   └── hooks/
├── public/ (Archivos estáticos)
├── DOCUMENTACION_FORMAL.md
├── GUIA_DE_USUARIO.md
└── README.md
```

## 🔐 Autenticación y Seguridad

- **Proveedor:** Supabase Auth
- **Método:** Email + Contraseña
- **Sesiones:** Server-Side Sessions (seguridad máxima)
- **JWT:** Tokens con duración configurable
- **Autorización:** Control por sucursal

## 💾 Base de Datos

Las tablas principales incluyen:
- `barbers` - Barberos
- `transactions` - Transacciones diarias
- `settlements` - Liquidaciones
- `weeks` - Períodos de cálculo
- `expenses` - Gastos e egresos
- `advances` - Adelantos a barberos
- `services` - Catálogo de servicios
- `branches` - Sucursales
- `admin_logs` - Auditoría completa

Ver `lib/supabase/database.types.ts` para esquema completo.

## 📊 Flujo Operacional

```
1. Registro Diario
   ├─ Barbero realiza servicio
   ├─ Se registra transacción en sistema
   └─ Monto se suma a liquidación pendiente

2. Cierre de Semana
   ├─ Se bloquean ediciones de transacciones
   ├─ Se calculan comisiones finales
   ├─ Se generan liquidaciones por barbero
   └─ Pendientes de confirmación

3. Confirmación
   ├─ Administrador revisa liquidaciones
   ├─ Aplica ajustes si es necesario
   └─ Confirma para pago

4. Pago
   ├─ Se entrega dinero al barbero
   └─ Se marca como "Pagada"

5. Auditoría
   └─ Todo queda registrado y auditable
```

## 🚀 Deploy

### Automático (Recomendado)
```bash
# Push a main/master
git push origin main

# Vercel detecta cambios automáticamente
# Build y deploy a producción
```

### Manual
```bash
# Build local
npm run build

# Verificar que funciona
npm start

# Luego hacer push
git push origin main
```

## 🔄 Migraciones de BD

Las migraciones SQL están en `lib/supabase/migrations/`.

Para aplicar nuevas migraciones:
```bash
# Supabase CLI
supabase migration up
```

## 📝 Módulos y Sus Funciones

| Módulo | URL | Función |
|--------|-----|---------|
| Dashboard | `/admin` | Registro diario, liquidaciones, transacciones |
| Barberos | `/admin/barberos` | Crear, editar, desactivar barberos |
| Administradores | `/admin/admins` | Gestionar usuarios del sistema |
| Servicios | `/admin/servicios` | Catálogo de servicios |
| Semanas | `/admin/semanas` | Definir períodos de cálculo |
| Beneficios | `/admin/beneficios` | Configurar bonos |
| Reportes | `/admin/reportes` | Análisis financieros |
| Auditoría | `/admin/auditoria` | Registro de cambios |
| Configuración | `/admin/configuracion` | Parámetros globales |

## 🐛 Debugging

### Logs
- **Servidor:** Ver en consola de desarrollo
- **BD:** Supabase Dashboard → Logs
- **Deploy:** Vercel Dashboard → Logs

### Errores Comunes
- **"Unauthorized"** → Verificar token de autenticación
- **"Permission denied"** → Revisar políticas RLS en Supabase
- **Datos no actualizan** → F5 para refresh, limpiar cache

## 📞 Soporte y Mantenimiento

**Desarrollador:** Bruno Ballinari  
**Email:** brunoballinari@gmail.com  
**Horarios:** Lunes-Viernes 9am-6pm  
**Respuesta:** 24-48 horas

### Mantenimiento Programado
- Backups automáticos cada 6 horas (Supabase)
- Monitoreo de performance continuo
- Actualización de dependencias mensual
- Revisión de seguridad trimestral

## 📈 Roadmap Futuro

- [ ] App móvil para barberos (React Native)
- [ ] Integración con POS/TPV
- [ ] Dashboard personalizado para barberos
- [ ] Notificaciones por email/SMS
- [ ] Análisis predictivo de ingresos
- [ ] Exportación automática de reportes

## 📄 Licencia

Este proyecto es propiedad privada. Contactar al desarrollador para términos de uso.

---

**¿Necesitas ayuda?** Lee las documentaciones:
- [DOCUMENTACION_FORMAL.md](./DOCUMENTACION_FORMAL.md) - Arquitectura y especificaciones
- [GUIA_DE_USUARIO.md](./GUIA_DE_USUARIO.md) - Cómo usar el sistema

**Última actualización:** Junio 2026  
**Versión:** 1.0.0
