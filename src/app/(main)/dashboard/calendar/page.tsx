import { auth } from "@/auth";
import { getCalendarTasks } from "@/actions/tasks";
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
  subMonths 
} from "date-fns";
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const { month: monthStr } = await searchParams;
  const currentMonth = monthStr ? new Date(monthStr) : new Date();
  
  const tasks = await getCalendarTasks();
  
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const startDate = startOfWeek(monthStart);
  const endDate = endOfWeek(monthEnd);
  
  const calendarDays = eachDayOfInterval({
    start: startDate,
    end: endDate,
  });

  const weekDays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <CalendarIcon className="w-6 h-6 text-primary" />
          Activities Calendar
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" asChild>
            <Link href={`/dashboard/calendar?month=${format(subMonths(monthStart, 1), "yyyy-MM")}`}>
              <ChevronLeft className="w-4 h-4" />
            </Link>
          </Button>
          <span className="text-lg font-semibold min-w-[150px] text-center">
            {format(monthStart, "MMMM yyyy")}
          </span>
          <Button variant="outline" size="icon" asChild>
            <Link href={`/dashboard/calendar?month=${format(addMonths(monthStart, 1), "yyyy-MM")}`}>
              <ChevronRight className="w-4 h-4" />
            </Link>
          </Button>
        </div>
      </div>

      <div className="border rounded-xl bg-card overflow-hidden">
        {/* Header Days */}
        <div className="grid grid-cols-7 border-b bg-muted/50">
          {weekDays.map(day => (
            <div key={day} className="p-3 text-center text-xs font-bold text-muted-foreground uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar Grid */}
        <div className="grid grid-cols-7 auto-rows-[120px]">
          {calendarDays.map((day, idx) => {
            const dayTasks = tasks.filter(t => t.dueDate && isSameDay(new Date(t.dueDate), day));
            const isCurrentMonth = isSameMonth(day, monthStart);
            const isToday = isSameDay(day, new Date());

            return (
              <div 
                key={day.toString()} 
                className={`border-r border-b p-2 transition-colors hover:bg-muted/10 ${!isCurrentMonth ? "bg-muted/30 text-muted-foreground" : "bg-background"}`}
              >
                <div className="flex justify-between items-start mb-1">
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${isToday ? "bg-primary text-primary-foreground" : ""}`}>
                    {format(day, "d")}
                  </span>
                </div>
                <div className="space-y-1 overflow-y-auto max-h-[80px] scrollbar-hide">
                  {dayTasks.map(task => (
                    <Link key={task.id} href={`/dashboard/leads/${task.leadId}`}>
                      <div className={`text-[10px] p-1 rounded border truncate mb-0.5 cursor-pointer hover:brightness-95 ${
                        task.status === "done" ? "bg-green-100 border-green-200 text-green-700 opacity-70" :
                        task.priority === "high" ? "bg-red-100 border-red-200 text-red-700" :
                        "bg-blue-100 border-blue-200 text-blue-700"
                      }`}>
                        {task.title}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
