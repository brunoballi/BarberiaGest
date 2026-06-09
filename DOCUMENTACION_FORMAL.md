# VALHALLA - Sistema de Gestión para Barberías
## Documentación Técnica y Funcional

**Versión:** 1.0  
**Fecha:** Junio 2026  
**Estado:** Producción  
**Autor:** Bruno Ballinari  

---

## 📋 RESUMEN EJECUTIVO

VALHALLA es un sistema web integral de gestión diseñado específicamente para barberías. Permite administrar:
- **Operaciones diarias**: registro de ventas, barberos, servicios
- **Liquidaciones**: cálculo automático de comisiones y pagos a barberos
- **Finanzas**: control de gastos, adelantos, balance de caja
- **Reportes**: análisis de desempeño y rentabilidad
- **Auditoría**: trazabilidad completa de todas las operaciones

### Tecnología
- **Frontend:** Next.js 16 + React 19 + Tailwind CSS 4
- **Backend:** Supabase (PostgreSQL + Auth)
- **Deploy:** Vercel (CI/CD automático)
- **Lenguaje:** TypeScript

---

## 🏗️ ARQUITECTURA DEL SISTEMA

### Estructura de Módulos

```
┌─────────────────────────────────────────────────┐
│         VALHALLA - SISTEMA DE GESTIÓN           │
└─────────────────────────────────────────────────┘
         ↓
    ┌────────────────────────────────────────┐
    │    LOGIN / AUTENTICACIÓN               │
    │    (Supabase Auth + Email)             │
    └────────────────────────────────────────┘
         ↓
    ┌────────────────────────────────────────┐
    │   SELECCIÓN DE SUCURSAL                │
    │   (Multi-sucursal support)             │
    └────────────────────────────────────────┘
         ↓
┌─────────────────────────────────────────────────┐
│              PANEL ADMINISTRATIVO               │
├─────────────────────────────────────────────────┤
│                                                 │
│  ┌─────────────────────────────────────────┐  │
│  │  1. DASHBOARD EN VIVO                   │  │
│  │     • Transacciones en tiempo real       │  │
│  │     • Liquidaciones activas              │  │
│  │     • Monitoreo de barberos              │  │
│  └─────────────────────────────────────────┘  │
│                                                 │
│  ┌─────────────────────────────────────────┐  │
│  │  2. ADMINISTRACIÓN                      │  │
│  │     ├─ Barberos (ABM)                   │  │
│  │     ├─ Administradores                  │  │
│  │     ├─ Servicios / Catálogo             │  │
│  │     ├─ Semanas de trabajo               │  │
│  │     ├─ Beneficios (bonos)               │  │
│  │     └─ Configuración general            │  │
│  └─────────────────────────────────────────┘  │
│                                                 │
│  ┌─────────────────────────────────────────┐  │
│  │  3. OPERACIONES FINANCIERAS             │  │
│  │     ├─ Liquidaciones de barberos        │  │
│  │     ├─ Transacciones diarias            │  │
│  │     ├─ Gastos (categorización)          │  │
│  │     ├─ Adelantos a barberos             │  │
│  │     └─ Saldo inicial / Cierre           │  │
│  └─────────────────────────────────────────┘  │
│                                                 │
│  ┌─────────────────────────────────────────┐  │
│  │  4. REPORTES Y ANÁLISIS                 │  │
│  │     ├─ Reportes financieros             │  │
│  │     ├─ Estadísticas por barbero         │  │
│  │     ├─ Análisis de rentabilidad         │  │
│  │     └─ Exportaciones de datos           │  │
│  └─────────────────────────────────────────┘  │
│                                                 │
│  ┌─────────────────────────────────────────┐  │
│  │  5. AUDITORÍA Y CONTROL                 │  │
│  │     ├─ Registro de cambios              │  │
│  │     ├─ Trazabilidad de transacciones    │  │
│  │     ├─ Historiales de usuarios          │  │
│  │     └─ Logs de operaciones              │  │
│  └─────────────────────────────────────────┘  │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## 📱 MÓDULOS PRINCIPALES

### 1. **DASHBOARD EN VIVO** (Admin Home)
**Ubicación:** `/admin`

#### Funcionalidades:
- **Pestaña "En Vivo"**: Tabla en tiempo real de transacciones del día
  - Filtros por barbero, método de pago, estado
  - Edición inline de valores
  - Split de comisión en vivo
  - Colores de estado (confirmada, pendiente, anulada)

- **Pestaña "Liquidaciones"**: Gestión de pagos a barberos
  - Cálculo automático de comisiones
  - Estado: Pendiente → Confirmada → Pagada
  - Permitir reclamos y modificaciones
  - Historial de liquidaciones

- **Pestaña "Transacciones"**: Registro detallado
  - Búsqueda avanzada
  - Filtros múltiples
  - Edición y anulación de registros

- **Pestaña "Gastos"**: Control de egresos
  - Categorización (Alquiler, Servicios, Suministros, Otros)
  - Registro por usuario
  - Análisis de gastos mensuales

- **Pestaña "Saldo Inicial"**: Balance de caja
  - Saldo inicial del mes
  - Cierre mensual
  - Reconciliación

- **Pestaña "Adelantos"**: Gestión de anticipo a barberos
  - Solicitud y aprobación
  - Descuento automático en liquidación

---

### 2. **ADMINISTRACIÓN DE BARBEROS**
**Ubicación:** `/admin/barberos`

#### Funcionalidades:
- **ABM Completo** (Alta, Baja, Modificación)
  - Registro de datos personales
  - Porcentaje de comisión configurable
  - Estado (Activo/Inactivo)
  - Bonus de presentismo (porcentaje adicional)
  - Objetivo de ventas mensual

- **Gestión de Barberos Inactivos**
  - Opción para desactivar barberos
  - Histórico de comisiones

- **Información del Barbero**
  - Nombre completo
  - DNI
  - Email
  - Teléfono
  - Porcentaje de comisión base
  - Estado de actividad

---

### 3. **ADMINISTRACIÓN DE ADMINISTRADORES**
**Ubicación:** `/admin/admins`

#### Funcionalidades:
- **Gestión de Usuarios Admin**
  - Crear nuevos administradores
  - Asignar permisos por sucursal
  - Editar información de acceso
  - Desactivar usuarios

- **Roles y Permisos**
  - Acceso por sucursal
  - Nivel de privilegios

---

### 4. **SERVICIOS/CATÁLOGO**
**Ubicación:** `/admin/servicios`

#### Funcionalidades:
- **Catálogo de Servicios**
  - Nombre del servicio
  - Precio base
  - Categoría
  - Descripción

- **Gestión de Precios**
  - Actualización de tarifas
  - Descuentos especiales
  - Servicios por sucursal

---

### 5. **SEMANAS DE TRABAJO**
**Ubicación:** `/admin/semanas`

#### Funcionalidades:
- **Calendario de Semanas**
  - Definición de períodos de liquidación
  - Fechas de inicio y cierre
  - Estado de cada semana (Abierta, Cerrada, Liquidada)

- **Cierre de Semana**
  - Cálculo automático de comisiones
  - Bloqueo de ediciones
  - Generación de reportes

---

### 6. **BENEFICIOS/BONOS**
**Ubicación:** `/admin/beneficios`

#### Funcionalidades:
- **Configuración de Bonos**
  - Bonus de presentismo (% extra)
  - Bonus de objetivo (% extra si cumple metas)
  - Aplicación automática o manual

- **Gestión de Beneficios**
  - Por barbero individual
  - Por período
  - Histórico de bonificaciones

---

### 7. **CONFIGURACIÓN**
**Ubicación:** `/admin/configuracion`

#### Funcionalidades:
- **Parámetros Globales**
  - Nombre de la sucursal
  - Datos fiscales
  - Configuración de transacciones

- **Métodos de Pago**
  - Configuración de tipos de pago
  - Nomenclatura personalizada

- **Horarios y Políticas**
  - Horario de atención
  - Políticas de cancelación
  - Configuración de semanas

---

### 8. **REPORTES**
**Ubicación:** `/admin/reportes`

#### Funcionalidades:
- **Reportes Financieros**
  - Ingresos por período
  - Egresos (gastos) por período
  - Balance neto
  - Análisis por método de pago

- **Reportes por Barbero**
  - Ventas totales
  - Comisiones ganadas
  - Tendencias

- **Exportación de Datos**
  - Descarga en formato tabla
  - Filtros avanzados

---

### 9. **AUDITORÍA**
**Ubicación:** `/admin/auditoria`

#### Funcionalidades:
- **Registro Completo de Cambios**
  - Quién hizo el cambio
  - Qué se cambió
  - Cuándo se cambió
  - Valores anteriores y nuevos

- **Filtros y Búsqueda**
  - Por usuario
  - Por tipo de operación
  - Por rango de fechas
  - Por entidad (transacción, barbero, etc.)

- **Trazabilidad**
  - Cascada de cambios
  - Historial completo de modificaciones

---

## 🔐 SEGURIDAD Y AUTENTICACIÓN

### Sistema de Autenticación
- **Proveedor:** Supabase Auth
- **Método:** Email + Contraseña
- **Sesiones:** Server-Side Sessions (SSR) para seguridad máxima
- **JWT:** Token con duración configurable
- **Cookies Seguras:** HttpOnly, Secure, SameSite

### Control de Acceso
- **Autenticación requerida** para todos los módulos
- **Autorización por sucursal** (usuarios ven solo su sucursal)
- **Roles diferenciados** (Admin total vs Admin de sucursal)

---

## 💾 BASE DE DATOS

### Entidades Principales

#### `barbers` (Barberos)
- id, branch_id, name, email, phone, document_number
- commission_percentage, is_active, created_at, updated_at

#### `transactions` (Transacciones)
- id, branch_id, barber_id, amount, payment_method
- status (pending/confirmed/cancelled), created_at, updated_at

#### `settlements` (Liquidaciones)
- id, branch_id, week_id, barber_id, total_amount
- status (pending/confirmed/paid), created_at, updated_at

#### `expenses` (Gastos)
- id, branch_id, category, amount, description, created_at

#### `advances` (Adelantos)
- id, branch_id, barber_id, amount, status, created_at

#### `weeks` (Semanas)
- id, branch_id, start_date, end_date, status, created_at

#### `services` (Servicios)
- id, branch_id, name, price, description, created_at

#### `branches` (Sucursales)
- id, name, address, city, created_at

#### `admin_logs` (Auditoría)
- id, user_id, action, table_name, record_id, changes, created_at

---

## 📊 CARACTERÍSTICAS AVANZADAS

### Cálculo de Comisiones
```
FÓRMULA AUTOMÁTICA:
Comisión Base = Monto Transacción × % Comisión Barbero

Con Presentismo:
Comisión Final = Comisión Base × (1 + % Presentismo)

Con Objetivo:
SI ventas_mes > objetivo_mes:
  Comisión Final += Comisión Base × % Bonus Objetivo
```

### Gestión de Liquidaciones
1. **Estado Pendiente**: Transacciones sin procesar
2. **Confirmación**: Revisión y ajuste de comisiones
3. **Pago**: Registro de liquidación efectuada
4. **Auditable**: Registro de todos los cambios

### Split de Comisiones
- Posibilidad de dividir transacciones entre múltiples barberos
- Porcentaje personalizable por transacción
- Recálculo automático de liquidaciones

---

## 🚀 DEPLOY Y MANTENIMIENTO

### Flujo de Deployment
```
Code Push → GitHub
    ↓
Vercel (Automated Build)
    ↓
Next.js Build
    ↓
Supabase Migrations (Auto)
    ↓
Production Deploy
    ↓
✅ Live en producción
```

### Monitoreo
- Logs de Vercel disponibles
- Errores en tiempo real
- Dashboard de Supabase para BD

---

## 📈 BENEFICIOS ENTREGADOS

### Para el Propietario
✅ Control total de operaciones financieras  
✅ Visibilidad en tiempo real de ingresos  
✅ Automatización de cálculos de comisiones  
✅ Reportes detallados para análisis  
✅ Auditoría completa de cambios  

### Para los Barberos
✅ Liquidaciones claras y transparentes  
✅ Posibilidad de solicitar adelantos  
✅ Sistema de bonos por desempeño  
✅ Historial de comisiones  

### Para la Administración
✅ Reducción de errores manuales  
✅ Gestión eficiente de barberos  
✅ Control de gastos categorizado  
✅ Escalabilidad a múltiples sucursales  

---

## 🎯 PRÓXIMAS MEJORAS SUGERIDAS

1. **App Móvil para Barberos** - Consulta de liquidaciones en tiempo real
2. **Integración con POS** - Importar transacciones automáticamente
3. **Dashboard para Barberos** - Ver mis comisiones y adelantos
4. **Notificaciones por Email** - Alertas de liquidaciones
5. **Backups Automáticos** - Seguridad de datos mejorada
6. **Estadísticas Avanzadas** - Análisis predictivo de ingresos

---

## 📞 SOPORTE Y MANTENIMIENTO

### Contacto Técnico
- **Desarrollador:** Bruno Ballinari
- **Email:** brunoballinari@gmail.com
- **Disponibilidad:** Horario laboral
- **Respuesta:** 24-48 horas

### Mantenimiento Preventivo
- Backups automáticos en Supabase
- Monitoreo continuo de performance
- Actualización de dependencias mensual
- Revisión de seguridad trimestral

---

**Este documento describe un sistema profesional y escalable diseñado para satisfacer las necesidades de un negocio de barberías moderno.**
