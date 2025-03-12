import React, { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Pressable,
  KeyboardAvoidingView,
  Platform,
  Modal,
  LayoutAnimation,
  UIManager,
  StyleSheet,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import AsyncStorage from "@react-native-async-storage/async-storage";
import DateTimePicker from "@react-native-community/datetimepicker";
import {
  format,
  startOfWeek,
  subMinutes,
  subHours,
  endOfWeek,
  addWeeks,
  subWeeks,
  parseISO,
  getDay,
  addDays,
} from "date-fns";
import { Ionicons } from "@expo/vector-icons";
import Checkbox from "expo-checkbox";
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications";

if (Platform.OS === "android") {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true, // Show alert even when app is open
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

const theme = {
  primary: "#00ffff",
  background: "#000000",
  card: "#1a1a1a",
  text: "#ffffff",
  secondaryText: "#b0b0b0",
  completed: "#505050",
  error: "#ff5555",
  separator: "#222222",
};

interface Todo {
  id: string;
  text: string;
  completed: boolean; // Used for non-recurring tasks
  createdAt: string;
  day: string;
  recurring?: {
    frequency: "daily" | "weekly" | "monthly";
  };
  completedInstances?: string[]; // Dates when recurring task instances are completed (yyyy-MM-dd)
  notificationPreference?: "none" | "atDue" | "30minBefore" | "1hourBefore"; // User’s choice
  notificationId?: string; // ID to manage the scheduled notification
}

async function ensureNotificationPermissions() {
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") {
    const { status: newStatus } = await Notifications.requestPermissionsAsync();
    if (newStatus !== "granted") {
      alert(
        "Please enable notifications in your settings to receive reminders."
      );
      return false;
    }
  }
  return true;
}

async function scheduleNotification(text: string, triggerTime: Date) {
  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: "Task Reminder",
      body: `Your task "${text}" is due soon.`,
    },
    trigger: {
      type: SchedulableTriggerInputTypes.DATE,
      date: triggerTime,
    },
  });
  return notificationId;
}

interface DaySection {
  day: string;
  date: Date;
  todos: Todo[];
  expanded: boolean;
}

const DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
];

export default function TodoApp() {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarDate, setCalendarDate] = useState(new Date());
  const [newTodo, setNewTodo] = useState("");
  const [selectedDay, setSelectedDay] = useState("MONDAY");
  const [todos, setTodos] = useState<Todo[]>([]);
  const today = new Date();
  const todayDayIndex = (getDay(today) + 6) % 7;
  const initialExpandedSections = DAYS.reduce((acc, day, index) => {
    acc[day] = index === todayDayIndex;
    return acc;
  }, {} as Record<string, boolean>);
  const [expandedSections, setExpandedSections] = useState(
    initialExpandedSections
  );
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [todoToDelete, setTodoToDelete] = useState<Todo | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [daySelectOpen, setDaySelectOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [todoToEdit, setTodoToEdit] = useState<Todo | null>(null);
  const [editText, setEditText] = useState("");
  const [editDay, setEditDay] = useState("MONDAY");
  const [filter, setFilter] = useState<"All" | "Incomplete" | "Completed">(
    "All"
  );
  const [showAddTimePicker, setShowAddTimePicker] = useState(false);
  const [addSelectedTime, setAddSelectedTime] = useState(new Date());
  const [showEditTimePicker, setShowEditTimePicker] = useState(false);
  const [editSelectedTime, setEditSelectedTime] = useState(new Date());
  const [recurrence, setRecurrence] = useState<
    "none" | "daily" | "weekly" | "monthly"
  >("none");
  const [recurrenceOpen, setRecurrenceOpen] = useState(false);
  const [editRecurrence, setEditRecurrence] = useState<
    "none" | "daily" | "weekly" | "monthly"
  >("none");
  const [editRecurrenceOpen, setEditRecurrenceOpen] = useState(false);
  const [notificationPreference, setNotificationPreference] = useState<
    "none" | "atDue" | "30minBefore" | "1hourBefore"
  >("none");
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [editNotificationPreference, setEditNotificationPreference] = useState<
    "none" | "atDue" | "30minBefore" | "1hourBefore"
  >("none");
  const [editNotificationOpen, setEditNotificationOpen] = useState(false);
  const [isSearchModalOpen, setIsSearchModalOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTodos = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return todos.filter((todo) =>
      todo.text.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [todos, searchQuery]);

  const handleResultClick = (todo: Todo) => {
    // Step 1: Clear the search query
    setSearchQuery("");

    // Step 2: Close the search modal
    setIsSearchModalOpen(false);

    // Step 4: Navigate to the week of the todo's createdAt date
    const todoDate = parseISO(todo.createdAt); // Convert createdAt string to Date object
    const startOfTodoWeek = startOfWeek(todoDate, { weekStartsOn: 1 }); // Start of week (Monday)
    setCurrentDate(startOfTodoWeek); // Update the app’s current week

    // Steps 3 & 5: Close other sections and expand the todo’s day
    setExpandedSections(
      DAYS.reduce((acc: Record<string, boolean>, day) => {
        acc[day] = day === todo.day; // true for the todo’s day, false for others
        return acc;
      }, {})
    );
  };

  useEffect(() => {
    const loadTodos = async () => {
      try {
        const storedTodos = await AsyncStorage.getItem("todos");
        if (storedTodos) {
          setTodos(JSON.parse(storedTodos));
        }
      } catch (error) {
        console.error("Failed to load todos", error);
      }
    };
    loadTodos();
  }, []);

  useEffect(() => {
    const saveTodos = async () => {
      try {
        await AsyncStorage.setItem("todos", JSON.stringify(todos));
      } catch (error) {
        console.error("Failed to save todos", error);
      }
    };
    saveTodos();
  }, [todos]);

  useEffect(() => {
    if (todoToEdit) {
      setEditText(todoToEdit.text);
      setEditDay(todoToEdit.day);
      setEditSelectedTime(parseISO(todoToEdit.createdAt));
      setEditRecurrence(
        todoToEdit.recurring ? todoToEdit.recurring.frequency : "none"
      );
      setEditNotificationPreference(
        todoToEdit.notificationPreference || "none"
      );
    }
  }, [todoToEdit]);

  const getDateForDay = (day: string) => {
    const dayIndex = DAYS.indexOf(day);
    return addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), dayIndex);
  };

  const shouldDisplayTodo = (todo: Todo, date: Date): boolean => {
    const todoDate = parseISO(todo.createdAt);
    if (!todo.recurring) {
      return format(todoDate, "yyyy-MM-dd") === format(date, "yyyy-MM-dd");
    } else {
      const frequency = todo.recurring.frequency;
      if (frequency === "daily") {
        return true; // Appears every day
      } else if (frequency === "weekly") {
        const dateDayIndex = (getDay(date) + 6) % 7; // 0 = Monday, 6 = Sunday
        const dateDayName = DAYS[dateDayIndex];
        return dateDayName === todo.day;
      } else if (frequency === "monthly") {
        return todoDate.getDate() === date.getDate(); // Same day of the month
      }
      return false;
    }
  };

  const addTodo = async () => {
    if (newTodo.trim()) {
      const todoDate = getDateForDay(selectedDay);
      const fullDate = new Date(todoDate);
      fullDate.setHours(
        addSelectedTime.getHours(),
        addSelectedTime.getMinutes(),
        0,
        0
      );
      let notificationId: string | undefined;

      if (notificationPreference !== "none" && recurrence === "none") {
        const hasPermission = await ensureNotificationPermissions();
        if (!hasPermission) {
          setNotificationPreference("none"); // Reset preference if denied
          return;
        }

        const dueTime = fullDate;
        let triggerTime: Date;
        switch (notificationPreference) {
          case "atDue":
            triggerTime = dueTime;
            break;
          case "30minBefore":
            triggerTime = subMinutes(dueTime, 30);
            break;
          case "1hourBefore":
            triggerTime = subHours(dueTime, 1);
            break;
          default:
            triggerTime = dueTime;
        }

        if (triggerTime > new Date()) {
          notificationId = await scheduleNotification(newTodo, triggerTime);
        }
      }

      const newTodoItem: Todo = {
        id: Date.now().toString(),
        text: newTodo,
        completed: false,
        createdAt: fullDate.toISOString(),
        day: selectedDay,
        ...(recurrence !== "none" && { recurring: { frequency: recurrence } }),
        ...(notificationPreference !== "none" &&
          recurrence === "none" && { notificationPreference }),
        notificationId,
      };

      setTodos((prevTodos) => [...prevTodos, newTodoItem]);
      setNewTodo("");
      setRecurrence("none");
      setNotificationPreference("none");
      setIsAddModalOpen(false);
      setExpandedSections(
        DAYS.reduce((acc, day) => {
          acc[day] = day === selectedDay;
          return acc;
        }, {} as Record<string, boolean>)
      );
    }
  };

  const toggleTodo = async (todoId: string, dateStr: string) => {
    let updatedTodos = todos;
    for (let i = 0; i < updatedTodos.length; i++) {
      const todo = updatedTodos[i];
      if (todo.id === todoId) {
        if (!todo.recurring) {
          const newCompleted = !todo.completed;
          if (newCompleted && todo.notificationId) {
            await Notifications.cancelScheduledNotificationAsync(
              todo.notificationId
            );
            updatedTodos[i] = {
              ...todo,
              completed: newCompleted,
              notificationId: undefined,
            };
          } else {
            updatedTodos[i] = { ...todo, completed: newCompleted };
          }
        } else {
          const completedInstances = todo.completedInstances || [];
          if (completedInstances.includes(dateStr)) {
            updatedTodos[i] = {
              ...todo,
              completedInstances: completedInstances.filter(
                (d) => d !== dateStr
              ),
            };
          } else {
            updatedTodos[i] = {
              ...todo,
              completedInstances: [...completedInstances, dateStr],
            };
          }
        }
      }
    }
    setTodos([...updatedTodos]);
  };

  const editTodo = async (id: string, newText: string, newDay: string) => {
    const prevTodo = todos.find((t) => t.id === id);
    if (!prevTodo) return;

    const newDayDate = getDateForDay(newDay);
    const newFullDate = new Date(newDayDate);
    newFullDate.setHours(
      editSelectedTime.getHours(),
      editSelectedTime.getMinutes(),
      0,
      0
    );

    let newNotificationId: string | undefined = prevTodo.notificationId;

    if (editRecurrence !== "none") {
      if (newNotificationId) {
        await Notifications.cancelScheduledNotificationAsync(newNotificationId);
        newNotificationId = undefined;
      }
    } else {
      const dueTimeChanged =
        newFullDate.getTime() !== parseISO(prevTodo.createdAt).getTime();
      const preferenceChanged =
        editNotificationPreference !== prevTodo.notificationPreference;

      if (
        newNotificationId &&
        (dueTimeChanged ||
          preferenceChanged ||
          editNotificationPreference === "none")
      ) {
        await Notifications.cancelScheduledNotificationAsync(newNotificationId);
        newNotificationId = undefined;
      }

      if (editNotificationPreference !== "none") {
        const hasPermission = await ensureNotificationPermissions();
        if (!hasPermission) {
          setEditNotificationPreference("none");
          return;
        }

        const dueTime = newFullDate;
        let triggerTime: Date;
        switch (editNotificationPreference) {
          case "atDue":
            triggerTime = dueTime;
            break;
          case "30minBefore":
            triggerTime = subMinutes(dueTime, 30);
            break;
          case "1hourBefore":
            triggerTime = subHours(dueTime, 1);
            break;
          default:
            triggerTime = dueTime;
        }

        if (triggerTime > new Date()) {
          newNotificationId = await scheduleNotification(newText, triggerTime);
        }
      }
    }

    setTodos((prevTodos) =>
      prevTodos.map((todo) =>
        todo.id === id
          ? {
              ...todo,
              text: newText,
              day: newDay,
              createdAt: newFullDate.toISOString(),
              recurring:
                editRecurrence !== "none"
                  ? { frequency: editRecurrence }
                  : undefined,
              completedInstances:
                editRecurrence !== "none" ? todo.completedInstances : undefined,
              notificationPreference:
                editRecurrence === "none" ? editNotificationPreference : "none",
              notificationId: newNotificationId,
            }
          : todo
      )
    );
    setIsEditModalOpen(false);
  };

  const changeWeek = (direction: "prev" | "next") => {
    setCurrentDate((prevDate) =>
      direction === "prev" ? subWeeks(prevDate, 1) : addWeeks(prevDate, 1)
    );
  };

  interface DateChangeEvent {
    type: string;
    nativeEvent: {
      timestamp: number;
    };
  }

  const handleDateChange = (
    event: DateChangeEvent,
    selectedDate?: Date | undefined
  ) => {
    setShowDatePicker(false);

    if (selectedDate) {
      setCalendarDate(selectedDate);
      setCurrentDate(selectedDate);

      const dayIndex = getDay(selectedDate);

      const adjustedIndex = dayIndex === 0 ? 6 : dayIndex - 1;

      if (adjustedIndex >= 0 && adjustedIndex < DAYS.length) {
        const selectedDay = DAYS[adjustedIndex];

        setExpandedSections(
          DAYS.reduce((acc, day) => {
            acc[day] = day === selectedDay;
            return acc;
          }, {} as Record<string, boolean>)
        );
      }
    }
  };

  const toggleSection = (day: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedSections((prev) => {
      const newState = { ...prev };
      Object.keys(newState).forEach((key) => {
        newState[key] = key === day ? !prev[day] : false;
      });
      return newState;
    });
  };

  const openDeleteModal = (todo: Todo) => {
    setTodoToDelete(todo);
    setIsDeleteModalOpen(true);
  };

  const confirmDelete = async () => {
    if (todoToDelete) {
      if (todoToDelete.notificationId) {
        await Notifications.cancelScheduledNotificationAsync(
          todoToDelete.notificationId
        );
      }
      setTodos((prevTodos) =>
        prevTodos.filter((todo) => todo.id !== todoToDelete.id)
      );
      setIsDeleteModalOpen(false);
      setTodoToDelete(null);
    }
  };

  const openEditModal = (todo: Todo) => {
    setTodoToEdit(todo);
    setEditText(todo.text);
    setEditDay(todo.day);
    setIsEditModalOpen(true);
  };

  interface FilterButtonProps {
    label: string;
    isActive: boolean;
    onPress: () => void;
  }

  const FilterButton: React.FC<FilterButtonProps> = ({
    label,
    isActive,
    onPress,
  }) => (
    <TouchableOpacity
      style={[styles.filterButton, isActive && styles.activeFilter]}
      onPress={onPress}
    >
      <Text style={[styles.filterText, isActive && styles.activeFilterText]}>
        {label}
      </Text>
    </TouchableOpacity>
  );

  const sections = useMemo(() => {
    return DAYS.map((day) => {
      const sectionDate = getDateForDay(day);
      const dayTodos = todos.filter((todo) =>
        shouldDisplayTodo(todo, sectionDate)
      );
      const filteredDayTodos = dayTodos.filter((todo) => {
        const isCompleted = todo.recurring
          ? (todo.completedInstances || []).includes(
              format(sectionDate, "yyyy-MM-dd")
            )
          : todo.completed;
        if (filter === "All") return true;
        if (filter === "Incomplete") return !isCompleted;
        if (filter === "Completed") return isCompleted;
        return true;
      });
      return {
        day,
        date: sectionDate,
        todos: filteredDayTodos.sort(
          (a, b) =>
            parseISO(a.createdAt).getTime() - parseISO(b.createdAt).getTime()
        ),
        expanded: expandedSections[day],
      };
    });
  }, [todos, filter, expandedSections, currentDate]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="auto" />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView style={styles.content}>
          <View style={styles.weekNavigation}>
            <TouchableOpacity
              style={styles.navigationButton}
              onPress={() => changeWeek("prev")}
              accessibilityLabel="Previous week"
            >
              <Ionicons name="chevron-back" size={24} color={theme.primary} />
            </TouchableOpacity>
            <Text style={styles.weekText}>
              {format(startOfWeek(currentDate, { weekStartsOn: 1 }), "MMM d")} -{" "}
              {format(
                endOfWeek(currentDate, { weekStartsOn: 1 }),
                "MMM d, yyyy"
              )}
            </Text>
            <TouchableOpacity
              style={styles.navigationButton}
              onPress={() => setShowDatePicker(true)}
              accessibilityLabel="Open calendar"
            >
              <Ionicons
                name="calendar-outline"
                size={24}
                color={theme.primary}
              />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navigationButton}
              onPress={() => setIsSearchModalOpen(true)}
              accessibilityLabel="Open search"
            >
              <Ionicons name="search" size={24} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navigationButton}
              onPress={() => changeWeek("next")}
              accessibilityLabel="Next week"
            >
              <Ionicons
                name="chevron-forward"
                size={24}
                color={theme.primary}
              />
            </TouchableOpacity>
          </View>
          <View style={styles.filterContainer}>
            <FilterButton
              label="All"
              isActive={filter === "All"}
              onPress={() => setFilter("All")}
            />
            <FilterButton
              label="Incomplete"
              isActive={filter === "Incomplete"}
              onPress={() => setFilter("Incomplete")}
            />
            <FilterButton
              label="Completed"
              isActive={filter === "Completed"}
              onPress={() => setFilter("Completed")}
            />
          </View>
          {sections.map((section) => (
            <DaySection
              key={section.day}
              day={section.day}
              date={section.date}
              todos={section.todos}
              expanded={section.expanded}
              onToggle={() => toggleSection(section.day)}
              onEdit={openEditModal}
              onDelete={openDeleteModal}
              onToggleTodo={toggleTodo}
            />
          ))}
        </ScrollView>
        <TouchableOpacity
          style={styles.fab}
          onPress={() => {
            const today = new Date();
            const todayIndex = getDay(today);
            const adjustedIndex = todayIndex === 0 ? 6 : todayIndex - 1;
            const currentDay = DAYS[adjustedIndex];
            setSelectedDay(currentDay);
            setAddSelectedTime(new Date()); // Reset to current time
            setIsAddModalOpen(true);
          }}
          accessibilityLabel="Add new todo"
        >
          <Ionicons name="add" size={24} color={theme.card} />
        </TouchableOpacity>
      </KeyboardAvoidingView>
      <Modal
        visible={isAddModalOpen}
        transparent={true}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setIsAddModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsAddModalOpen(false)}
          />
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Add New Todo</Text>
            <TextInput
              style={styles.input}
              placeholder="Enter todo text"
              placeholderTextColor={theme.secondaryText}
              value={newTodo}
              onChangeText={setNewTodo}
              accessibilityLabel="Todo text input"
            />
            <Pressable
              style={styles.daySelector}
              onPress={() => setDaySelectOpen(!daySelectOpen)}
              accessibilityLabel="Select day"
            >
              <Text style={styles.daySelectorText}>{selectedDay}</Text>
            </Pressable>
            {daySelectOpen && (
              <View style={styles.daySelectDropdown}>
                {DAYS.map((day) => (
                  <Pressable
                    key={day}
                    style={styles.daySelectItem}
                    onPress={() => {
                      setSelectedDay(day);
                      setDaySelectOpen(false);
                    }}
                  >
                    <Text style={styles.daySelectItemText}>{day}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable
              style={styles.timeSelector}
              onPress={() => setShowAddTimePicker(true)}
              accessibilityLabel="Select time"
            >
              <Text style={styles.timeSelectorText}>
                {format(addSelectedTime, "hh:mm a")}
              </Text>
            </Pressable>
            <Pressable
              style={styles.daySelector}
              onPress={() => setRecurrenceOpen(!recurrenceOpen)}
              accessibilityLabel="Select recurrence"
            >
              <Text style={styles.daySelectorText}>
                {recurrence === "none"
                  ? "No recurrence"
                  : recurrence.charAt(0).toUpperCase() + recurrence.slice(1)}
              </Text>
            </Pressable>
            {recurrenceOpen && (
              <View style={styles.daySelectDropdown}>
                {["none", "daily", "weekly", "monthly"].map((option) => (
                  <Pressable
                    key={option}
                    style={styles.daySelectItem}
                    onPress={() => {
                      setRecurrence(
                        option as "none" | "daily" | "weekly" | "monthly"
                      );
                      setRecurrenceOpen(false);
                    }}
                  >
                    <Text style={styles.daySelectItemText}>
                      {option === "none"
                        ? "No recurrence"
                        : option.charAt(0).toUpperCase() + option.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {recurrence === "none" && (
              <Pressable
                style={styles.daySelector}
                onPress={() => setNotificationOpen(!notificationOpen)}
                accessibilityLabel="Select notification preference"
              >
                <Text style={styles.daySelectorText}>
                  {notificationPreference === "none"
                    ? "No notification"
                    : notificationPreference === "atDue"
                    ? "At due time"
                    : notificationPreference === "30minBefore"
                    ? "30 minutes before"
                    : "1 hour before"}
                </Text>
              </Pressable>
            )}
            {notificationOpen && recurrence === "none" && (
              <View style={styles.daySelectDropdown}>
                {["none", "atDue", "30minBefore", "1hourBefore"].map(
                  (option) => (
                    <Pressable
                      key={option}
                      style={styles.daySelectItem}
                      onPress={() => {
                        setNotificationPreference(option as any);
                        setNotificationOpen(false);
                      }}
                    >
                      <Text style={styles.daySelectItemText}>
                        {option === "none"
                          ? "No notification"
                          : option === "atDue"
                          ? "At due time"
                          : option === "30minBefore"
                          ? "30 minutes before"
                          : "1 hour before"}
                      </Text>
                    </Pressable>
                  )
                )}
              </View>
            )}
            {Platform.OS === "ios" && showAddTimePicker && (
              <Modal
                transparent={true}
                visible={showAddTimePicker}
                animationType="fade"
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.datePickerContainer}>
                    <View style={styles.datePickerHeader}>
                      <TouchableOpacity
                        onPress={() => setShowAddTimePicker(false)}
                      >
                        <Text
                          style={{
                            color: theme.primary,
                            fontSize: 16,
                            fontWeight: "600",
                          }}
                        >
                          Done
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={addSelectedTime}
                      mode="time"
                      display="spinner"
                      onChange={(event, date) => {
                        if (date) setAddSelectedTime(date);
                      }}
                    />
                  </View>
                </View>
              </Modal>
            )}
            {Platform.OS === "android" && showAddTimePicker && (
              <DateTimePicker
                value={addSelectedTime}
                mode="time"
                display="default"
                onChange={(event, date) => {
                  setShowAddTimePicker(false);
                  if (date) setAddSelectedTime(date);
                }}
              />
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setIsAddModalOpen(false)}
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addButton}
                onPress={addTodo}
                accessibilityLabel="Add todo"
              >
                <Text style={styles.addButtonText}>Add</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={isEditModalOpen}
        transparent={true}
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Edit Todo</Text>
            <TextInput
              style={styles.input}
              value={editText}
              onChangeText={setEditText}
              placeholderTextColor={theme.secondaryText}
              accessibilityLabel="Edit todo text"
            />
            <Pressable
              style={styles.daySelector}
              onPress={() => setDaySelectOpen(!daySelectOpen)}
              accessibilityLabel="Select day"
            >
              <Text style={styles.daySelectorText}>{editDay}</Text>
            </Pressable>
            {daySelectOpen && (
              <View style={styles.daySelectDropdown}>
                {DAYS.map((day) => (
                  <Pressable
                    key={day}
                    style={styles.daySelectItem}
                    onPress={() => {
                      setEditDay(day);
                      setDaySelectOpen(false);
                    }}
                  >
                    <Text style={styles.daySelectItemText}>{day}</Text>
                  </Pressable>
                ))}
              </View>
            )}
            <Pressable
              style={styles.timeSelector}
              onPress={() => setShowEditTimePicker(true)}
              accessibilityLabel="Select time"
            >
              <Text style={styles.timeSelectorText}>
                {format(editSelectedTime, "hh:mm a")}
              </Text>
            </Pressable>
            <Pressable
              style={styles.daySelector}
              onPress={() => setEditRecurrenceOpen(!editRecurrenceOpen)}
              accessibilityLabel="Select recurrence"
            >
              <Text style={styles.daySelectorText}>
                {editRecurrence === "none"
                  ? "No recurrence"
                  : editRecurrence.charAt(0).toUpperCase() +
                    editRecurrence.slice(1)}
              </Text>
            </Pressable>
            {editRecurrenceOpen && (
              <View style={styles.daySelectDropdown}>
                {["none", "daily", "weekly", "monthly"].map((option) => (
                  <Pressable
                    key={option}
                    style={styles.daySelectItem}
                    onPress={() => {
                      setEditRecurrence(
                        option as "none" | "daily" | "weekly" | "monthly"
                      );
                      setEditRecurrenceOpen(false);
                    }}
                  >
                    <Text style={styles.daySelectItemText}>
                      {option === "none"
                        ? "No recurrence"
                        : option.charAt(0).toUpperCase() + option.slice(1)}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}
            {editRecurrence === "none" && (
              <Pressable
                style={styles.daySelector}
                onPress={() => setEditNotificationOpen(!editNotificationOpen)}
                accessibilityLabel="Select notification preference"
              >
                <Text style={styles.daySelectorText}>
                  {editNotificationPreference === "none"
                    ? "No notification"
                    : editNotificationPreference === "atDue"
                    ? "At due time"
                    : editNotificationPreference === "30minBefore"
                    ? "30 minutes before"
                    : "1 hour before"}
                </Text>
              </Pressable>
            )}
            {editNotificationOpen && editRecurrence === "none" && (
              <View style={styles.daySelectDropdown}>
                {["none", "atDue", "30minBefore", "1hourBefore"].map(
                  (option) => (
                    <Pressable
                      key={option}
                      style={styles.daySelectItem}
                      onPress={() => {
                        setEditNotificationPreference(option as any);
                        setEditNotificationOpen(false);
                      }}
                    >
                      <Text style={styles.daySelectItemText}>
                        {option === "none"
                          ? "No notification"
                          : option === "atDue"
                          ? "At due time"
                          : option === "30minBefore"
                          ? "30 minutes before"
                          : "1 hour before"}
                      </Text>
                    </Pressable>
                  )
                )}
              </View>
            )}
            {Platform.OS === "ios" && showEditTimePicker && (
              <Modal
                transparent={true}
                visible={showEditTimePicker}
                animationType="fade"
              >
                <View style={styles.modalOverlay}>
                  <View style={styles.datePickerContainer}>
                    <View style={styles.datePickerHeader}>
                      <TouchableOpacity
                        onPress={() => setShowEditTimePicker(false)}
                      >
                        <Text
                          style={{
                            color: theme.primary,
                            fontSize: 16,
                            fontWeight: "600",
                          }}
                        >
                          Done
                        </Text>
                      </TouchableOpacity>
                    </View>
                    <DateTimePicker
                      value={editSelectedTime}
                      mode="time"
                      display="spinner"
                      onChange={(event, date) => {
                        if (date) setEditSelectedTime(date);
                      }}
                    />
                  </View>
                </View>
              </Modal>
            )}
            {Platform.OS === "android" && showEditTimePicker && (
              <DateTimePicker
                value={editSelectedTime}
                mode="time"
                display="default"
                onChange={(event, date) => {
                  setShowEditTimePicker(false);
                  if (date) setEditSelectedTime(date);
                }}
              />
            )}
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setIsEditModalOpen(false)}
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.addButton}
                onPress={() => editTodo(todoToEdit!.id, editText, editDay)}
                accessibilityLabel="Save changes"
              >
                <Text style={styles.addButtonText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={isDeleteModalOpen}
        transparent={true}
        animationType="fade"
        statusBarTranslucent
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Confirm Deletion</Text>
            <Text style={styles.modalText}>
              Are you sure you want to delete this todo?
              {todoToDelete && (
                <Text style={{ fontWeight: "600" }}>
                  {"\n"}"{todoToDelete.text}"
                </Text>
              )}
            </Text>
            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={styles.cancelButton}
                onPress={() => setIsDeleteModalOpen(false)}
                accessibilityLabel="Cancel"
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.deleteConfirmButton}
                onPress={confirmDelete}
                accessibilityLabel="Delete todo"
              >
                <Text style={styles.deleteConfirmButtonText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
      {Platform.OS === "ios" && showDatePicker && (
        <Modal
          transparent={true}
          visible={showDatePicker}
          animationType="fade"
          statusBarTranslucent
        >
          <View style={styles.modalOverlay}>
            <View style={styles.datePickerContainer}>
              <View style={styles.datePickerHeader}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text
                    style={{
                      color: theme.primary,
                      fontSize: 16,
                      fontWeight: "600",
                    }}
                  >
                    Done
                  </Text>
                </TouchableOpacity>
              </View>
              <DateTimePicker
                value={calendarDate}
                mode="date"
                display="spinner"
                onChange={handleDateChange}
                accentColor={theme.primary}
                textColor={theme.text}
              />
            </View>
          </View>
        </Modal>
      )}
      {Platform.OS === "android" && showDatePicker && (
        <DateTimePicker
          value={calendarDate}
          mode="date"
          display="default"
          onChange={handleDateChange}
          accentColor={theme.primary}
        />
      )}
      <Modal
        visible={isSearchModalOpen}
        transparent={true}
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() => setIsSearchModalOpen(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={StyleSheet.absoluteFill}
            activeOpacity={1}
            onPress={() => setIsSearchModalOpen(false)}
          />
          <View style={styles.searchModalContent}>
            <Text style={styles.modalTitle}>Search Todos</Text>
            <TextInput
              style={styles.input}
              placeholder="Search todos..."
              placeholderTextColor={theme.secondaryText}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoFocus={true}
              accessibilityLabel="Search input"
            />
            <ScrollView style={styles.searchResultsContainer}>
              {filteredTodos.length > 0 ? (
                filteredTodos.map((todo) => (
                  <Pressable
                    key={todo.id}
                    style={styles.searchResultItem}
                    onPress={() => {
                      setIsSearchModalOpen(false);
                      setCurrentDate(parseISO(todo.createdAt));
                      setExpandedSections({
                        ...DAYS.reduce(
                          (acc, d) => ({ ...acc, [d]: false }),
                          {}
                        ),
                        [todo.day]: true,
                      });
                    }}
                  >
                    <Pressable
                      onPress={() => handleResultClick(todo)}
                      style={styles.searchResultText}
                    >
                      <Text style={{ color: theme.text }}>{todo.text}</Text>
                    </Pressable>
                    <Text style={styles.searchResultDay}>{todo.day}</Text>
                    {todo.recurring && (
                      <Ionicons
                        name="repeat"
                        size={16}
                        color={theme.secondaryText}
                        style={{ marginLeft: 4 }}
                      />
                    )}
                  </Pressable>
                ))
              ) : (
                <Text style={styles.emptySearch}>
                  {searchQuery
                    ? "No matching todos found"
                    : "Enter a search term"}
                </Text>
              )}
            </ScrollView>
            <TouchableOpacity
              style={styles.cancelButton}
              onPress={() => setIsSearchModalOpen(false)}
              accessibilityLabel="Close search"
            >
              <Text style={styles.cancelButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

interface TodoItemProps {
  todo: Todo;
  date: Date; // Add date prop
  onToggle: (id: string, date: string) => void; // Update signature
  onDelete: (todo: Todo) => void;
  onEdit: (todo: Todo) => void;
}

const TodoItem: React.FC<TodoItemProps> = ({
  todo,
  date,
  onToggle,
  onDelete,
  onEdit,
}) => {
  const isCompleted = todo.recurring
    ? (todo.completedInstances || []).includes(format(date, "yyyy-MM-dd"))
    : todo.completed;

  const handleTodoToggle = (e: any) => {
    e.stopPropagation();
    onToggle(todo.id, format(date, "yyyy-MM-dd"));
  };

  const handleEditPress = (e: any) => {
    e.stopPropagation();
    onEdit(todo);
  };

  const handleDelete = (e: any) => {
    e.stopPropagation();
    onDelete(todo);
  };

  return (
    <View style={styles.todoItem}>
      <TouchableOpacity
        onPress={handleTodoToggle}
        style={{
          padding: 8,
          borderWidth: 1,
          borderColor: isCompleted ? "transparent" : theme.secondaryText,
          borderRadius: 4,
        }}
      >
        <Checkbox
          value={isCompleted}
          color={isCompleted ? theme.primary : undefined}
        />
      </TouchableOpacity>
      <Pressable style={{ flex: 1 }} onPress={handleTodoToggle}>
        <View style={{ flexDirection: "row", alignItems: "center" }}>
          <Text
            style={isCompleted ? styles.todoTextCompleted : styles.todoText}
          >
            {todo.text}
          </Text>
          {todo.notificationPreference &&
            todo.notificationPreference !== "none" && (
              <Ionicons
                name="notifications-outline"
                size={16}
                color={theme.secondaryText}
                style={{ marginLeft: 4 }}
              />
            )}
          {todo.recurring && (
            <Ionicons
              name="repeat"
              size={16}
              color={theme.secondaryText}
              style={{ marginLeft: 4 }}
            />
          )}
        </View>
      </Pressable>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={handleEditPress}
        accessibilityLabel="Edit todo"
      >
        <Ionicons name="pencil-outline" size={20} color={theme.primary} />
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={handleDelete}
        accessibilityLabel="Delete todo"
      >
        <Ionicons name="trash-outline" size={20} color={theme.error} />
      </TouchableOpacity>
    </View>
  );
};

interface DaySectionProps {
  day: string;
  date: Date;
  todos: Todo[];
  expanded: boolean;
  onToggle: () => void;
  onEdit: (todo: Todo) => void;
  onDelete: (todo: Todo) => void;
  onToggleTodo: (id: string, date: string) => void; // Update signature
}

const DaySection: React.FC<DaySectionProps> = ({
  day,
  date,
  todos,
  expanded,
  onToggle,
  onEdit,
  onDelete,
  onToggleTodo,
}) => (
  <View style={[styles.daySection, !expanded && { opacity: 0.9 }]}>
    <Pressable
      style={styles.daySectionHeader}
      onPress={onToggle}
      accessibilityLabel={`${day}, ${todos.length} todo${
        todos.length !== 1 ? "s" : ""
      }`}
    >
      <Text style={styles.daySectionTitle}>{day}</Text>
      <Text style={styles.todoCount}>({todos.length})</Text>
    </Pressable>
    {expanded && (
      <View style={styles.daySectionContent}>
        <Text style={styles.dateInfo}>{format(date, "MMMM d, yyyy")}</Text>
        {todos.length > 0 ? (
          todos.map((todo) => (
            <TodoItem
              key={todo.id + "_" + format(date, "yyyy-MM-dd")} // Unique key per instance
              todo={todo}
              date={date}
              onToggle={onToggleTodo}
              onDelete={onDelete}
              onEdit={onEdit}
            />
          ))
        ) : (
          <Text style={styles.emptyList}>Nothing to do yet—add a task!</Text>
        )}
      </View>
    )}
  </View>
);

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { flex: 1, padding: 16 },
  weekNavigation: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: theme.card,
    borderRadius: 8,
    padding: 16,
    marginBottom: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  incompleteSwitchContainer: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingHorizontal: 16,
    marginBottom: 16,
  },
  navigationButton: { padding: 8 },
  weekText: { fontWeight: "600", fontSize: 16, color: theme.text },
  fab: {
    position: "absolute",
    bottom: 20,
    right: 20,
    backgroundColor: theme.primary,
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: "center",
    alignItems: "center",
    elevation: 4,
  },
  modalOverlay: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(0, 0, 0, 0.5)",
  },
  modalContent: {
    backgroundColor: theme.card,
    borderRadius: 8,
    padding: 20,
    width: "80%",
    elevation: 5,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: "bold",
    marginBottom: 16,
    color: theme.text,
  },
  input: {
    borderWidth: 1,
    borderColor: theme.secondaryText,
    borderRadius: 4,
    padding: 12,
    marginBottom: 12,
    color: theme.text,
  },
  daySelector: {
    borderWidth: 1,
    borderColor: theme.secondaryText,
    borderRadius: 4,
    padding: 12,
    marginBottom: 12,
  },
  daySelectorText: { color: theme.text },
  daySelectDropdown: {
    position: "absolute",
    top: 110,
    right: 0,
    backgroundColor: theme.card,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.secondaryText,
    width: 140,
    elevation: 5,
    zIndex: 1000,
  },
  daySelectItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: theme.separator,
  },
  daySelectItemText: { color: theme.text },
  modalButtons: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginTop: 16,
  },
  cancelButton: {
    padding: 12,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: theme.secondaryText,
    alignItems: "center",
    marginRight: 8,
  },
  cancelButtonText: { color: theme.text },
  addButton: {
    backgroundColor: theme.primary,
    padding: 12,
    borderRadius: 4,
    alignItems: "center",
  },
  addButtonText: { color: theme.card, fontWeight: "600" },
  deleteConfirmButton: {
    backgroundColor: theme.error,
    padding: 12,
    borderRadius: 4,
    alignItems: "center",
  },
  deleteConfirmButtonText: { color: "#ffffff", fontWeight: "600" },
  modalText: { marginBottom: 20, color: theme.text },
  daySection: {
    backgroundColor: theme.card,
    borderRadius: 8,
    marginBottom: 16,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  daySectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    padding: 16,
  },
  daySectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: theme.text,
  },
  todoCount: {
    fontSize: 14,
    color: theme.secondaryText,
    marginLeft: 8,
  },
  daySectionContent: { padding: 16, paddingTop: 0 },
  dateInfo: { fontSize: 14, color: theme.secondaryText, marginBottom: 16 },
  todoItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    borderRadius: 4,
  },
  todoText: { fontSize: 16, color: theme.text, marginLeft: 8 },
  todoTextCompleted: {
    fontSize: 16,
    color: theme.completed,
    marginLeft: 8,
    textDecorationLine: "line-through",
  },
  deleteButton: { padding: 8 },
  emptyList: { color: theme.secondaryText, fontSize: 14, fontStyle: "italic" },
  datePickerContainer: {
    backgroundColor: theme.card,
    padding: Platform.OS === "ios" ? 16 : 0,
    borderRadius: 8,
  },
  datePickerHeader: {
    flexDirection: "row",
    justifyContent: "flex-end",
    marginBottom: 8,
  },
  filterContainer: {
    flexDirection: "row",
    justifyContent: "space-around",
    marginVertical: 10,
  },
  filterButton: {
    flex: 1,
    padding: 10,
    borderRadius: 5,
    backgroundColor: theme.card,
    marginHorizontal: 5,
    alignItems: "center",
  },
  activeFilter: {
    backgroundColor: theme.primary,
  },
  activeFilterText: {
    color: theme.card,
  },
  filterText: {
    color: theme.text,
    fontWeight: "600",
  },
  timeSelector: {
    borderWidth: 1,
    borderColor: theme.secondaryText,
    borderRadius: 4,
    padding: 12,
    marginBottom: 12,
  },
  timeSelectorText: { color: theme.text },
  todoTime: {
    fontSize: 12,
    color: theme.secondaryText,
    marginTop: 4,
    marginLeft: 8,
  },
  searchModalContent: {
    backgroundColor: theme.card,
    borderRadius: 8,
    padding: 20,
    width: "90%",
    maxHeight: "80%",
    elevation: 5,
  },
  searchResultsContainer: {
    maxHeight: 300,
    marginTop: 10,
  },
  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: theme.separator,
  },
  searchResultText: {
    flex: 1,
    fontSize: 16,
    color: theme.text,
  },
  searchResultDay: {
    fontSize: 12,
    color: theme.secondaryText,
    marginRight: 8,
  },
  emptySearch: {
    fontSize: 14,
    color: theme.secondaryText,
    textAlign: "center",
    marginTop: 20,
  },
});
