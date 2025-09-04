import { add } from 'date-fns';

type Recurrence = 'weekly' | 'monthly' | 'quarterly' | 'half_yearly' | 'yearly' | 'two_yearly';
type DueDateInterval = 'one_week' | 'two_weeks' | 'one_month' | 'three_months' | 'six_months' | 'one_year';


// Calculate the next occurrence date for a recurring measure
export function calculateNextOccurrence(dateCreated: Date, recurrence: Recurrence): Date {
  switch (recurrence) {
    case 'weekly':
      return add(dateCreated, { weeks: 1 });
    
    case 'monthly':
      return add(dateCreated, { months: 1 });
    
    case 'quarterly':
      return add(dateCreated, { months: 3 });
    
    case 'half_yearly':
      return add(dateCreated, { months: 6 });
    
    case 'yearly':
      return add(dateCreated, { years: 1 });
    
    case 'two_yearly':
      return add(dateCreated, { years: 2 });
    
    default:
      throw new Error(`Invalid recurrence: ${recurrence}`);
  }
}


// Calculate the due date for a measure assignment given the measure is recurring
export function calculateMeasureAssignmentDueDate(assignmentDate: Date, dueDateInterval: DueDateInterval): Date {
  // For recurring measures, calculate based on the interval
  if (!dueDateInterval) {
    throw new Error('Recurring measures must have a due_date_interval');
  }

  switch (dueDateInterval) {
    case 'one_week':
      return add(assignmentDate, { weeks: 1 });
    
    case 'two_weeks':
      return add(assignmentDate, { weeks: 2 });
    
    case 'one_month':
      return add(assignmentDate, { months: 1 });
    
    case 'three_months':
      return add(assignmentDate, { months: 3 });
    
    case 'six_months':
      return add(assignmentDate, { months: 6 });
    
    case 'one_year':
      return add(assignmentDate, { years: 1 });
    
    default:
      throw new Error(`Invalid due date interval: ${dueDateInterval}`);
  }
}
