import { getCalendarEvents } from "@/actions/calendar";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths,
  addWeeks,
  subWeeks,
  isSameWeek,
  eachHourOfInterval,
  startOfDay,
  endOfDay
} from "date-fns";
import { 
  ChevronLeft, 
  ChevronRight, 
  Calendar as CalendarIcon, 
  PhoneIcon, 
  UsersIcon, 
  CheckSquareIcon,
  LayoutGridIcon,
  ColumnsIcon,
  ListIcon
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FormattedDate } from "@/components/crm/formatted-date";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; view?: string; date?: string }>;
}) {
  const { month: monthStr, view: viewParam, date: dateParam } = await searchParams;
  const currentView = viewParam || "month";
  const baseDate = dateParam ? new Date(dateParam) : monthStr ? new Date(monthStr) : new Date();
  
  const events = await getCalendarEvents();
  
  const monthStart = startOfMonth(baseDate);
  const weekStart = startOfWeek(baseDate, { weekStartsOn: 1 });
  
  const renderHeader = () => {
    let title = format(monthStart, "MMMM yyyy");
    let prevUrl = "";
    let nextUrl = "";

    if (currentView === "month") {
      prevUrl = `/dashboard/calendar?view=month&date=${format(subMonths(baseDate, 1), "yyyy-MM-dd")}`;
      nextUrl = `/dashboard/calendar?view=month&date=${format(addMonths(baseDate, 1), "yyyy-MM-dd")}`;
    } else if (currentView === "week") {
      title = `Week of ${format(weekStart, "MMM d, yyyy")}`;
      prevUrl = `/dashboard/calendar?view=week&date=${format(subWeeks(baseDate, 1), "yyyy-MM-dd")}`;
      nextUrl = `/dashboard/calendar?view=week&date=${format(addWeeks(baseDate, 1), "yyyy-MM-dd")}`;
    } else {
      title = "Agenda";
    }

    return (
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-primary" />
          CRM Calendar
        </h1>
        
        <div className="flex items-center gap-4">
          <Tabs defaultValue={currentView}>
            <TabsList>
              <TabsTrigger value="month" asChild>
                <Link href={`/dashboard/calendar?view=month&date=${format(baseDate, "yyyy-MM-dd")}`}>
                  <LayoutGridIcon className="w-4 h-4 mr-2" /> Month
                </Link>
              </TabsTrigger>
              <TabsTrigger value="week" asChild>
                <Link href={`/dashboard/calendar?view=week&date=${format(baseDate, "yyyy-MM-dd")}`}>
                  <ColumnsIcon className="w-4 h-4 mr-2" /> Week
                </Link>
              </TabsTrigger>
              <TabsTrigger value="agenda" asChild>
                <Link href={`/dashboard/calendar?view=agenda&date=${format(baseDate, "yyyy-MM-dd")}`}>
                  <ListIcon className="w-4 h-4 mr-2" /> Agenda
                </Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <div className="flex items-center gap-2 bg-muted rounded-lg p-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link href={prevUrl}>
                <ChevronLeft className="w-4 h-4" />
              </Link>
            </Button>
            <span className="text-sm font-semibold min-w-[120px] text-center">
              {title}
            </span>
            <Button variant="ghost" size="icon" className="h-8 w-8" asChild>
              <Link href={nextUrl}>
                <ChevronRight className="w-4 h-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    );
  };

  const getEventStyle = (event: any) => {
    if (event.type === "task") return "bg-blue-50 border-blue-200 text-blue-700";
    if (event.type === "meeting") return "bg-purple-50 border-purple-200 text-purple-700";
    if (event.type === "call") return "bg-green-50 border-green-200 text-green-700";
    return "bg-slate-50 border-slate-200 text-slate-700";
  };

  const getEventIcon = (type: string) => {
    if (type === "task") return <CheckSquareIcon className="w-3 h-3" />;
    if (type === "meeting") return <UsersIcon className="w-3 h-3" />;
    if (type === "call") return <PhoneIcon className="w-3 h-3" />;
    return null;
  };

  const renderMonthView = () => {
    const monthEnd = endOfMonth(monthStart);
    const startDate = startOfWeek(monthStart, { weekStartsOn: 1 });
    const endDate = endOfWeek(monthEnd, { weekStartsOn: 1 });
    const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
    const weekDays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

    return (
      <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-7 border-b bg-muted/30">
          {weekDays.map(day => (
            <div key={day} className="p-3 text-center text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-7 auto-rows-[minmax(120px,auto)]">
          {calendarDays.map((day) => {
            const dayEvents = events.filter(e => e.date && isSameDay(new Date(e.date), day));
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, new Date());

            return (
              <div 
                key={day.toString()} 
                className={`border-r border-b p-2 min-h-[120px] transition-colors hover:bg-muted/5 ${!isCurrentMonth ? "bg-muted/20 text-muted-foreground" : "bg-background"}`}
              >
                <div className="flex justify-end mb-1">
                  <span className={`text-xs font-bold w-6 h-6 flex items-center justify-center rounded-full ${isToday ? "bg-primary text-primary-foreground" : ""}`}>
                    {format(day, "d")}
                  </span>
                </div>
                <div className="space-y-1">
                  {dayEvents.slice(0, 4).map(event => (
                    <Link key={event.id} href={event.link}>
                      <div className={`text-[9px] p-1 rounded border truncate flex flex-col gap-0.5 group hover:shadow-sm transition-all ${getEventStyle(event)}`}>
                        <div className="flex items-center gap-1 font-bold">
                          {getEventIcon(event.type)}
                          <span className="truncate">
                            <FormattedDate date={event.date} includeTime={true} /> - {event.displayTitle}
                          </span>
                        </div>
                        <div className="text-[8px] opacity-80 italic truncate pl-4">
                          @{event.entityName}
                        </div>
                      </div>
                    </Link>
                  ))}
                  {dayEvents.length > 4 && (
                    <div className="text-[8px] text-center font-semibold text-muted-foreground">
                      + {dayEvents.length - 4} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderWeekView = () => {
    const weekDays = eachDayOfInterval({
      start: weekStart,
      end: endOfWeek(baseDate, { weekStartsOn: 1 }),
    });

    return (
      <div className="border rounded-xl bg-card overflow-hidden shadow-sm">
        <div className="grid grid-cols-8 border-b bg-muted/30">
          <div className="p-3 border-r"></div>
          {weekDays.map(day => (
            <div key={day.toString()} className={`p-3 text-center ${isSameDay(day, new Date()) ? "bg-primary/5" : ""}`}>
              <div className="text-xs font-bold text-muted-foreground uppercase">{format(day, "EEE")}</div>
              <div className={`text-lg font-bold ${isSameDay(day, new Date()) ? "text-primary" : ""}`}>{format(day, "d")}</div>
            </div>
          ))}
        </div>
        <div className="divide-y">
          {["All Day Tasks", "Scheduled"].map((section, idx) => (
            <div key={section} className="grid grid-cols-8 min-h-[200px]">
              <div className="p-2 border-r bg-muted/10 flex items-center justify-center">
                <span className="text-[10px] font-bold uppercase text-muted-foreground rotate-180 [writing-mode:vertical-lr]">{section}</span>
              </div>
              {weekDays.map(day => {
                const dayEvents = events.filter(e => {
                  const d = new Date(e.date);
                  const matchesDay = isSameDay(d, day);
                  if (idx === 0) return matchesDay && e.type === "task";
                  return matchesDay && e.type !== "task";
                });
                
                return (
                  <div key={day.toString()} className="p-2 border-r space-y-2">
                    {dayEvents.map(event => (
                      <Link key={event.id} href={event.link}>
                        <div className={`text-[10px] p-2 rounded-lg border shadow-sm flex flex-col gap-1 ${getEventStyle(event)}`}>
                          <div className="flex items-center gap-1 font-bold">
                            {getEventIcon(event.type)}
                            <span>{event.displayTitle}</span>
                          </div>
                          <Badge variant="outline" className="text-[8px] h-4 bg-background/50 border-none w-fit">
                            {event.entityName}
                          </Badge>
                        </div>
                      </Link>
                    ))}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderAgendaView = () => {
    const sortedEvents = [...events].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const upcomingEvents = sortedEvents.filter(e => new Date(e.date) >= startOfDay(new Date()));

    return (
      <div className="space-y-4">
        {upcomingEvents.length === 0 ? (
          <div className="text-center py-20 bg-muted/10 border-2 border-dashed rounded-xl">
            <CalendarIcon className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
            <p className="text-muted-foreground">No upcoming activities found.</p>
          </div>
        ) : (
          upcomingEvents.map(event => (
            <Link key={event.id} href={event.link}>
              <Card className="hover:shadow-md transition-shadow cursor-pointer overflow-hidden border-l-4" style={{ borderLeftColor: event.type === 'task' ? '#3b82f6' : event.type === 'meeting' ? '#a855f7' : '#22c55e' }}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className={`p-3 rounded-full ${getEventStyle(event)} bg-opacity-20`}>
                      {getEventIcon(event.type)}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">{event.displayTitle}</h3>
                      <p className="text-xs text-muted-foreground flex items-center gap-2 mt-1">
                        <span className="font-semibold text-primary capitalize">{event.type}</span>
                        <span>•</span>
                        <span>{event.entityName}</span>
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold">{format(new Date(event.date), "MMM d, yyyy")}</div>
                    <div className="text-[10px] text-muted-foreground uppercase">{format(new Date(event.date), "EEEE")}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))
        )}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-8 max-w-[1600px] mx-auto">
      {renderHeader()}
      
      <div className="mt-4">
        {currentView === "month" && renderMonthView()}
        {currentView === "week" && renderWeekView()}
        {currentView === "agenda" && renderAgendaView()}
      </div>
    </div>
  );
}
