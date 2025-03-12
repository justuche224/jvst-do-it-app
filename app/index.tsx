import React, {
  useState,
  useEffect,
  useMemo,
  useRef,
  createContext,
  useContext,
} from "react";
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
  Animated,
  Easing,
  useColorScheme,
  AppState,
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
import { SafeAreaView } from "react-native-safe-area-context";
import * as Notifications from "expo-notifications";
import { SchedulableTriggerInputTypes } from "expo-notifications";
import { BlurView } from "expo-blur";

if (Platform.OS === "android") {
  if (UIManager.setLayoutAnimationEnabledExperimental) {
    UIManager.setLayoutAnimationEnabledExperimental(true);
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

// Define themes for both light and dark mode
const themes = {
  light: {
    primary: "#00cccc",
    primaryDark: "#00a3a3",
    background: "#f5f5f5",
    card: "#ffffff",
    cardHighlight: "#f0f0f0",
    text: "#000000",
    secondaryText: "#666666",
    completed: "#aaaaaa",
    error: "#ff3333",
    separator: "#e0e0e0",
    success: "#4caf50",
    warning: "#ff9800",
  },
  dark: {
    primary: "#00ffff",
    primaryDark: "#00cccc",
    background: "#000000",
    card: "#121212",
    cardHighlight: "#1e1e1e",
    text: "#ffffff",
    secondaryText: "#b0b0b0",
    completed: "#505050",
    error: "#ff5555",
    separator: "#222222",
    success: "#50fa7b",
    warning: "#ffb86c",
  },
};

// Create a context for theme
const ThemeContext = createContext({
  theme: themes.dark,
  isDark: true,
});

interface Todo {
  id: string;
  text: string;
  completed: boolean;
  createdAt: string;
  day: string;
  recurring?: {
    frequency: "daily" | "weekly" | "monthly";
  };
  completedInstances?: string[];
  notificationPreference?: "none" | "atDue" | "30minBefore" | "1hourBefore";
  notificationId?: string;
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

// Theme Provider component
const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const colorScheme = useColorScheme();
  console.log(colorScheme);

  const [isDark, setIsDark] = useState(colorScheme === "dark");
  const appState = useRef(AppState.currentState);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextAppState) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === "active"
      ) {
        // App has come to the foreground, check color scheme again
        setIsDark(colorScheme === "dark");
      }
      appState.current = nextAppState;
    });

    return () => {
      subscription.remove();
    };
  }, [colorScheme]);

  // Update theme when system preference changes
  useEffect(() => {
    setIsDark(colorScheme === "dark");
  }, [colorScheme]);

  const theme = isDark ? themes.dark : themes.light;

  return (
    <ThemeContext.Provider value={{ theme, isDark }}>
      {children}
    </ThemeContext.Provider>
  );
};

const useTheme = () => useContext(ThemeContext);

export default function TodoApp() {
  return (
    <ThemeProvider>
      <TodoAppContent />
    </ThemeProvider>
  );
}

function TodoAppContent() {
  const { theme, isDark } = useTheme();
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

  // Animation values
  const fabAnim = useRef(new Animated.Value(1)).current;
  const modalAnim = useRef(new Animated.Value(0)).current;
  const searchInputAnim = useRef(new Animated.Value(0)).current;

  const filteredTodos = useMemo(() => {
    if (!searchQuery.trim()) return [];
    return todos.filter((todo) =>
      todo.text.toLowerCase().includes(searchQuery.toLowerCase())
    );
  }, [todos, searchQuery]);

  const handleResultClick = (todo: Todo) => {
    // Animate search closing
    Animated.timing(searchInputAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
      easing: Easing.out(Easing.ease),
    }).start(() => {
      setSearchQuery("");
      setIsSearchModalOpen(false);
    });

    const todoDate = parseISO(todo.createdAt);
    const startOfTodoWeek = startOfWeek(todoDate, { weekStartsOn: 1 });
    setCurrentDate(startOfTodoWeek);

    setExpandedSections(
      DAYS.reduce((acc: Record<string, boolean>, day) => {
        acc[day] = day === todo.day;
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

  // Modal animation
  useEffect(() => {
    if (
      isAddModalOpen ||
      isEditModalOpen ||
      isDeleteModalOpen ||
      isSearchModalOpen
    ) {
      Animated.timing(modalAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }).start();
    } else {
      Animated.timing(modalAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
        easing: Easing.in(Easing.ease),
      }).start();
    }
  }, [isAddModalOpen, isEditModalOpen, isDeleteModalOpen, isSearchModalOpen]);

  // Search animation
  useEffect(() => {
    if (isSearchModalOpen) {
      Animated.timing(searchInputAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
        easing: Easing.out(Easing.ease),
      }).start();
    }
  }, [isSearchModalOpen]);

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
        return true;
      } else if (frequency === "weekly") {
        const dateDayIndex = (getDay(date) + 6) % 7;
        const dateDayName = DAYS[dateDayIndex];
        return dateDayName === todo.day;
      } else if (frequency === "monthly") {
        return todoDate.getDate() === date.getDate();
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
          setNotificationPreference("none");
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

      // Animate adding a new todo
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          300,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity
        )
      );

      setTodos((prevTodos) => [...prevTodos, newTodoItem]);
      setNewTodo("");
      setRecurrence("none");
      setNotificationPreference("none");

      // Close modal with animation
      Animated.timing(modalAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
        easing: Easing.in(Easing.ease),
      }).start(() => {
        setIsAddModalOpen(false);
      });

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

    // Animate the todo state change
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        200,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity
      )
    );

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

    // Animate the edit
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        300,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.opacity
      )
    );

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

    // Close modal with animation
    Animated.timing(modalAnim, {
      toValue: 0,
      duration: 200,
      useNativeDriver: true,
      easing: Easing.in(Easing.ease),
    }).start(() => {
      setIsEditModalOpen(false);
    });
  };

  const changeWeek = (direction: "prev" | "next") => {
    // Animate week change
    const initialValue = direction === "prev" ? -0.3 : 0.3;
    const slideAnim = new Animated.Value(initialValue);

    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 300,
      useNativeDriver: true,
      easing: Easing.out(Easing.ease),
    }).start();

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

        // Animate section expansion
        LayoutAnimation.configureNext(
          LayoutAnimation.create(
            300,
            LayoutAnimation.Types.easeInEaseOut,
            LayoutAnimation.Properties.scaleXY
          )
        );

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
    // Enhanced animation for section toggle
    LayoutAnimation.configureNext(
      LayoutAnimation.create(
        300,
        LayoutAnimation.Types.easeInEaseOut,
        LayoutAnimation.Properties.scaleXY
      )
    );

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

      // Animate deletion
      LayoutAnimation.configureNext(
        LayoutAnimation.create(
          300,
          LayoutAnimation.Types.easeInEaseOut,
          LayoutAnimation.Properties.opacity
        )
      );

      setTodos((prevTodos) =>
        prevTodos.filter((todo) => todo.id !== todoToDelete.id)
      );

      // Close modal with animation
      Animated.timing(modalAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
        easing: Easing.in(Easing.ease),
      }).start(() => {
        setIsDeleteModalOpen(false);
        setTodoToDelete(null);
      });
    }
  };

  const openEditModal = (todo: Todo) => {
    setTodoToEdit(todo);
    setEditText(todo.text);
    setEditDay(todo.day);
    setIsEditModalOpen(true);
  };

  // FAB animation
  const animateFab = (toValue: number) => {
    Animated.spring(fabAnim, {
      toValue,
      friction: 5,
      tension: 40,
      useNativeDriver: true,
    }).start();
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
      style={[
        styles(theme).filterButton,
        isActive && styles(theme).activeFilter,
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text
        style={[
          styles(theme).filterText,
          isActive && styles(theme).activeFilterText,
        ]}
      >
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
    <SafeAreaView style={styles(theme).container}>
      <StatusBar style={isDark ? "light" : "dark"} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView
          style={styles(theme).content}
          showsVerticalScrollIndicator={false}
          onScrollBeginDrag={() => animateFab(0.8)}
          onScrollEndDrag={() => animateFab(1)}
        >
          <View style={styles(theme).weekNavigation}>
            <TouchableOpacity
              style={styles(theme).navigationButton}
              onPress={() => changeWeek("prev")}
              accessibilityLabel="Previous week"
            >
              <Ionicons name="chevron-back" size={24} color={theme.primary} />
            </TouchableOpacity>
            <TouchableOpacity
              style={styles(theme).searchButton}
              onPress={() => setIsSearchModalOpen(true)}
              accessibilityLabel="Open search"
            >
              <Ionicons name="search" size={20} color={theme.text} />
              <Text style={styles(theme).searchButtonText}>
                Search todos...
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles(theme).navigationButton}
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
              style={styles(theme).navigationButton}
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

          <Text style={styles(theme).weekText}>
            {format(startOfWeek(currentDate, { weekStartsOn: 1 }), "MMM d")} -{" "}
            {format(endOfWeek(currentDate, { weekStartsOn: 1 }), "MMM d, yyyy")}
          </Text>

          <View style={styles(theme).filterContainer}>
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

          <View style={{ height: 80 }} />
        </ScrollView>

        <Animated.View
          style={[
            styles(theme).fabContainer,
            {
              transform: [{ scale: fabAnim }],
            },
          ]}
        >
          <TouchableOpacity
            style={styles(theme).fab}
            onPress={() => {
              const today = new Date();
              const todayIndex = getDay(today);
              const adjustedIndex = todayIndex === 0 ? 6 : todayIndex - 1;
              const currentDay = DAYS[adjustedIndex];
              setSelectedDay(currentDay);
              setAddSelectedTime(new Date());
              setIsAddModalOpen(true);

              // Animate the FAB press
              Animated.sequence([
                Animated.timing(fabAnim, {
                  toValue: 0.8,
                  duration: 100,
                  useNativeDriver: true,
                }),
                Animated.spring(fabAnim, {
                  toValue: 1,
                  friction: 3,
                  tension: 40,
                  useNativeDriver: true,
                }),
              ]).start();
            }}
            accessibilityLabel="Add new todo"
          >
            <Ionicons name="add" size={28} color={theme.card} />
          </TouchableOpacity>
        </Animated.View>
      </KeyboardAvoidingView>

      {/* Add Todo Modal */}
      <Modal
        visible={isAddModalOpen}
        transparent={true}
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setIsAddModalOpen(false)}
      >
        <BlurView
          intensity={100}
          style={StyleSheet.absoluteFill}
          tint={isDark ? "dark" : "light"}
        >
          <Animated.View
            style={[
              styles(theme).modalOverlay,
              {
                opacity: modalAnim,
                transform: [
                  {
                    scale: modalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.9, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setIsAddModalOpen(false)}
            />
            <View style={styles(theme).modalContent}>
              <View style={styles(theme).modalHandle} />
              <Text style={styles(theme).modalTitle}>Add New Todo</Text>
              <TextInput
                style={styles(theme).input}
                placeholder="Enter todo text"
                placeholderTextColor={theme.secondaryText}
                value={newTodo}
                onChangeText={setNewTodo}
                accessibilityLabel="Todo text input"
              />
              <Pressable
                style={styles(theme).daySelector}
                onPress={() => setDaySelectOpen(!daySelectOpen)}
                accessibilityLabel="Select day"
              >
                <Text style={styles(theme).daySelectorText}>{selectedDay}</Text>
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={theme.secondaryText}
                />
              </Pressable>
              {daySelectOpen && (
                <View style={styles(theme).daySelectDropdown}>
                  {DAYS.map((day) => (
                    <Pressable
                      key={day}
                      style={styles(theme).daySelectItem}
                      onPress={() => {
                        setSelectedDay(day);
                        setDaySelectOpen(false);
                      }}
                    >
                      <Text style={styles(theme).daySelectItemText}>{day}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Pressable
                style={styles(theme).timeSelector}
                onPress={() => setShowAddTimePicker(true)}
                accessibilityLabel="Select time"
              >
                <Text style={styles(theme).timeSelectorText}>
                  {format(addSelectedTime, "hh:mm a")}
                </Text>
                <Ionicons
                  name="time-outline"
                  size={16}
                  color={theme.secondaryText}
                />
              </Pressable>
              <Pressable
                style={styles(theme).daySelector}
                onPress={() => setRecurrenceOpen(!recurrenceOpen)}
                accessibilityLabel="Select recurrence"
              >
                <Text style={styles(theme).daySelectorText}>
                  {recurrence === "none"
                    ? "No recurrence"
                    : recurrence.charAt(0).toUpperCase() + recurrence.slice(1)}
                </Text>
                <Ionicons name="repeat" size={16} color={theme.secondaryText} />
              </Pressable>
              {recurrenceOpen && (
                <View style={styles(theme).daySelectDropdown}>
                  {["none", "daily", "weekly", "monthly"].map((option) => (
                    <Pressable
                      key={option}
                      style={styles(theme).daySelectItem}
                      onPress={() => {
                        setRecurrence(
                          option as "none" | "daily" | "weekly" | "monthly"
                        );
                        setRecurrenceOpen(false);
                      }}
                    >
                      <Text style={styles(theme).daySelectItemText}>
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
                  style={styles(theme).daySelector}
                  onPress={() => setNotificationOpen(!notificationOpen)}
                  accessibilityLabel="Select notification preference"
                >
                  <Text style={styles(theme).daySelectorText}>
                    {notificationPreference === "none"
                      ? "No notification"
                      : notificationPreference === "atDue"
                      ? "At due time"
                      : notificationPreference === "30minBefore"
                      ? "30 minutes before"
                      : "1 hour before"}
                  </Text>
                  <Ionicons
                    name="notifications-outline"
                    size={16}
                    color={theme.secondaryText}
                  />
                </Pressable>
              )}
              {notificationOpen && recurrence === "none" && (
                <View style={styles(theme).daySelectDropdown}>
                  {["none", "atDue", "30minBefore", "1hourBefore"].map(
                    (option) => (
                      <Pressable
                        key={option}
                        style={styles(theme).daySelectItem}
                        onPress={() => {
                          setNotificationPreference(option as any);
                          setNotificationOpen(false);
                        }}
                      >
                        <Text style={styles(theme).daySelectItemText}>
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
                  <BlurView
                    intensity={80}
                    style={StyleSheet.absoluteFill}
                    tint={isDark ? "dark" : "light"}
                  >
                    <View style={styles(theme).datePickerContainer}>
                      <View style={styles(theme).datePickerHeader}>
                        <TouchableOpacity
                          onPress={() => setShowAddTimePicker(false)}
                        >
                          <Text style={styles(theme).datePickerDoneText}>
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
                        textColor={theme.text}
                      />
                    </View>
                  </BlurView>
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
              <View style={styles(theme).modalButtons}>
                <TouchableOpacity
                  style={styles(theme).cancelButton}
                  onPress={() => setIsAddModalOpen(false)}
                  accessibilityLabel="Cancel"
                >
                  <Text style={styles(theme).cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles(theme).addButton}
                  onPress={addTodo}
                  accessibilityLabel="Add todo"
                >
                  <Text style={styles(theme).addButtonText}>Add</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </BlurView>
      </Modal>

      {/* Edit Todo Modal */}
      <Modal
        visible={isEditModalOpen}
        transparent={true}
        animationType="none"
        statusBarTranslucent
      >
        <BlurView
          intensity={80}
          style={StyleSheet.absoluteFill}
          tint={isDark ? "dark" : "light"}
        >
          <Animated.View
            style={[
              styles(theme).modalOverlay,
              {
                opacity: modalAnim,
                transform: [
                  {
                    scale: modalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.9, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setIsEditModalOpen(false)}
            />
            <View style={styles(theme).modalContent}>
              <View style={styles(theme).modalHandle} />
              <Text style={styles(theme).modalTitle}>Edit Todo</Text>
              <TextInput
                style={styles(theme).input}
                value={editText}
                onChangeText={setEditText}
                placeholderTextColor={theme.secondaryText}
                accessibilityLabel="Edit todo text"
              />
              <Pressable
                style={styles(theme).daySelector}
                onPress={() => setDaySelectOpen(!daySelectOpen)}
                accessibilityLabel="Select day"
              >
                <Text style={styles(theme).daySelectorText}>{editDay}</Text>
                <Ionicons
                  name="chevron-down"
                  size={16}
                  color={theme.secondaryText}
                />
              </Pressable>
              {daySelectOpen && (
                <View style={styles(theme).daySelectDropdown}>
                  {DAYS.map((day) => (
                    <Pressable
                      key={day}
                      style={styles(theme).daySelectItem}
                      onPress={() => {
                        setEditDay(day);
                        setDaySelectOpen(false);
                      }}
                    >
                      <Text style={styles(theme).daySelectItemText}>{day}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
              <Pressable
                style={styles(theme).timeSelector}
                onPress={() => setShowEditTimePicker(true)}
                accessibilityLabel="Select time"
              >
                <Text style={styles(theme).timeSelectorText}>
                  {format(editSelectedTime, "hh:mm a")}
                </Text>
                <Ionicons
                  name="time-outline"
                  size={16}
                  color={theme.secondaryText}
                />
              </Pressable>
              <Pressable
                style={styles(theme).daySelector}
                onPress={() => setEditRecurrenceOpen(!editRecurrenceOpen)}
                accessibilityLabel="Select recurrence"
              >
                <Text style={styles(theme).daySelectorText}>
                  {editRecurrence === "none"
                    ? "No recurrence"
                    : editRecurrence.charAt(0).toUpperCase() +
                      editRecurrence.slice(1)}
                </Text>
                <Ionicons name="repeat" size={16} color={theme.secondaryText} />
              </Pressable>
              {editRecurrenceOpen && (
                <View style={styles(theme).daySelectDropdown}>
                  {["none", "daily", "weekly", "monthly"].map((option) => (
                    <Pressable
                      key={option}
                      style={styles(theme).daySelectItem}
                      onPress={() => {
                        setEditRecurrence(
                          option as "none" | "daily" | "weekly" | "monthly"
                        );
                        setEditRecurrenceOpen(false);
                      }}
                    >
                      <Text style={styles(theme).daySelectItemText}>
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
                  style={styles(theme).daySelector}
                  onPress={() => setEditNotificationOpen(!editNotificationOpen)}
                  accessibilityLabel="Select notification preference"
                >
                  <Text style={styles(theme).daySelectorText}>
                    {editNotificationPreference === "none"
                      ? "No notification"
                      : editNotificationPreference === "atDue"
                      ? "At due time"
                      : editNotificationPreference === "30minBefore"
                      ? "30 minutes before"
                      : "1 hour before"}
                  </Text>
                  <Ionicons
                    name="notifications-outline"
                    size={16}
                    color={theme.secondaryText}
                  />
                </Pressable>
              )}
              {editNotificationOpen && editRecurrence === "none" && (
                <View style={styles(theme).daySelectDropdown}>
                  {["none", "atDue", "30minBefore", "1hourBefore"].map(
                    (option) => (
                      <Pressable
                        key={option}
                        style={styles(theme).daySelectItem}
                        onPress={() => {
                          setEditNotificationPreference(option as any);
                          setEditNotificationOpen(false);
                        }}
                      >
                        <Text style={styles(theme).daySelectItemText}>
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
                  <BlurView
                    intensity={80}
                    style={StyleSheet.absoluteFill}
                    tint={isDark ? "dark" : "light"}
                  >
                    <View style={styles(theme).datePickerContainer}>
                      <View style={styles(theme).datePickerHeader}>
                        <TouchableOpacity
                          onPress={() => setShowEditTimePicker(false)}
                        >
                          <Text style={styles(theme).datePickerDoneText}>
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
                        textColor={theme.text}
                      />
                    </View>
                  </BlurView>
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
              <View style={styles(theme).modalButtons}>
                <TouchableOpacity
                  style={styles(theme).cancelButton}
                  onPress={() => setIsEditModalOpen(false)}
                  accessibilityLabel="Cancel"
                >
                  <Text style={styles(theme).cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles(theme).addButton}
                  onPress={() => editTodo(todoToEdit!.id, editText, editDay)}
                  accessibilityLabel="Save changes"
                >
                  <Text style={styles(theme).addButtonText}>Save</Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </BlurView>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        visible={isDeleteModalOpen}
        transparent={true}
        animationType="none"
        statusBarTranslucent
      >
        <BlurView
          intensity={80}
          style={StyleSheet.absoluteFill}
          tint={isDark ? "dark" : "light"}
        >
          <Animated.View
            style={[
              styles(theme).modalOverlay,
              {
                opacity: modalAnim,
                transform: [
                  {
                    scale: modalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.9, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setIsDeleteModalOpen(false)}
            />
            <View style={styles(theme).modalContent}>
              <View style={styles(theme).modalHandle} />
              <Text style={[styles(theme).modalTitle, { alignSelf: "center" }]}>
                Confirm Deletion
              </Text>
              <Text style={styles(theme).modalText}>
                Are you sure you want to delete this todo?
                {todoToDelete && (
                  <Text style={{ fontWeight: "600" }}>
                    {"\n"}"{todoToDelete.text}"
                  </Text>
                )}
              </Text>
              <View style={styles(theme).modalButtons}>
                <TouchableOpacity
                  style={styles(theme).cancelButton}
                  onPress={() => setIsDeleteModalOpen(false)}
                  accessibilityLabel="Cancel"
                >
                  <Text style={styles(theme).cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles(theme).deleteConfirmButton}
                  onPress={confirmDelete}
                  accessibilityLabel="Delete todo"
                >
                  <Text style={styles(theme).deleteConfirmButtonText}>
                    Delete
                  </Text>
                </TouchableOpacity>
              </View>
            </View>
          </Animated.View>
        </BlurView>
      </Modal>

      {/* Date Picker Modal */}
      {Platform.OS === "ios" && showDatePicker && (
        <Modal
          transparent={true}
          visible={showDatePicker}
          animationType="fade"
          statusBarTranslucent
        >
          <BlurView
            intensity={80}
            style={StyleSheet.absoluteFill}
            tint={isDark ? "dark" : "light"}
          >
            <View style={styles(theme).datePickerContainer}>
              <View style={styles(theme).datePickerHeader}>
                <TouchableOpacity onPress={() => setShowDatePicker(false)}>
                  <Text style={styles(theme).datePickerDoneText}>Done</Text>
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
          </BlurView>
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

      {/* Search Modal */}
      <Modal
        visible={isSearchModalOpen}
        transparent={true}
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setIsSearchModalOpen(false)}
      >
        <BlurView
          intensity={80}
          style={StyleSheet.absoluteFill}
          tint={isDark ? "dark" : "light"}
        >
          <Animated.View
            style={[
              styles(theme).modalOverlay,
              {
                opacity: modalAnim,
                transform: [
                  {
                    scale: modalAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [0.9, 1],
                    }),
                  },
                ],
              },
            ]}
          >
            <TouchableOpacity
              style={StyleSheet.absoluteFill}
              activeOpacity={1}
              onPress={() => setIsSearchModalOpen(false)}
            />
            <Animated.View
              style={[
                styles(theme).searchModalContent,
                {
                  transform: [
                    {
                      translateY: searchInputAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [20, 0],
                      }),
                    },
                  ],
                },
              ]}
            >
              <View style={styles(theme).modalHandle} />
              <Text style={styles(theme).modalTitle}>Search Todos</Text>
              <View style={styles(theme).searchInputContainer}>
                <Ionicons
                  name="search"
                  size={20}
                  color={theme.secondaryText}
                  style={styles(theme).searchIcon}
                />
                <TextInput
                  style={styles(theme).searchInput}
                  placeholder="Search todos..."
                  placeholderTextColor={theme.secondaryText}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoFocus={true}
                  accessibilityLabel="Search input"
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery("")}
                    style={styles(theme).clearSearchButton}
                  >
                    <Ionicons
                      name="close-circle"
                      size={20}
                      color={theme.secondaryText}
                    />
                  </TouchableOpacity>
                )}
              </View>
              <ScrollView
                style={styles(theme).searchResultsContainer}
                showsVerticalScrollIndicator={false}
              >
                {filteredTodos.length > 0 ? (
                  filteredTodos.map((todo) => (
                    <Pressable
                      key={todo.id}
                      style={styles(theme).searchResultItem}
                      onPress={() => handleResultClick(todo)}
                      android_ripple={{ color: theme.cardHighlight }}
                    >
                      <View style={styles(theme).searchResultTextContainer}>
                        <Text style={styles(theme).searchResultTextMain}>
                          {todo.text}
                        </Text>
                        <View style={styles(theme).searchResultMeta}>
                          <Text style={styles(theme).searchResultDay}>
                            {todo.day}
                          </Text>
                          <Text style={styles(theme).searchResultDate}>
                            {format(parseISO(todo.createdAt), "MMM d, yyyy")}
                          </Text>
                        </View>
                      </View>
                      <View style={styles(theme).searchResultIcons}>
                        {todo.recurring && (
                          <Ionicons
                            name="repeat"
                            size={16}
                            color={theme.primary}
                            style={{ marginLeft: 4 }}
                          />
                        )}
                        {todo.notificationPreference &&
                          todo.notificationPreference !== "none" && (
                            <Ionicons
                              name="notifications-outline"
                              size={16}
                              color={theme.primary}
                              style={{ marginLeft: 4 }}
                            />
                          )}
                      </View>
                    </Pressable>
                  ))
                ) : (
                  <Text style={styles(theme).emptySearch}>
                    {searchQuery
                      ? "No matching todos found"
                      : "Enter a search term"}
                  </Text>
                )}
              </ScrollView>
              <TouchableOpacity
                style={styles(theme).closeSearchButton}
                onPress={() => setIsSearchModalOpen(false)}
                accessibilityLabel="Close search"
              >
                <Text style={styles(theme).closeSearchButtonText}>Close</Text>
              </TouchableOpacity>
            </Animated.View>
          </Animated.View>
        </BlurView>
      </Modal>
    </SafeAreaView>
  );
}

interface TodoItemProps {
  todo: Todo;
  date: Date;
  onToggle: (id: string, date: string) => void;
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
  const { theme } = useTheme();
  const isCompleted = todo.recurring
    ? (todo.completedInstances || []).includes(format(date, "yyyy-MM-dd"))
    : todo.completed;

  // Animation for checkbox
  const checkboxAnim = useRef(new Animated.Value(isCompleted ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(checkboxAnim, {
      toValue: isCompleted ? 1 : 0,
      duration: 200,
      useNativeDriver: false,
      easing: Easing.out(Easing.ease),
    }).start();
  }, [isCompleted]);

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

  const checkboxBorderColor = checkboxAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [theme.secondaryText, theme.primary],
  });

  const checkboxBackgroundColor = checkboxAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["transparent", theme.primary],
  });

  return (
    <Pressable
      style={styles(theme).todoItem}
      onPress={handleTodoToggle}
      android_ripple={{ color: theme.cardHighlight }}
    >
      <TouchableOpacity
        onPress={handleTodoToggle}
        style={styles(theme).checkboxContainer}
      >
        <Animated.View
          style={[
            styles(theme).customCheckbox,
            {
              borderColor: checkboxBorderColor,
              backgroundColor: checkboxBackgroundColor,
            },
          ]}
        >
          {isCompleted && (
            <Ionicons name="checkmark" size={16} color={theme.card} />
          )}
        </Animated.View>
      </TouchableOpacity>
      <View style={{ flex: 1 }}>
        <View style={styles(theme).todoTextContainer}>
          <Text
            style={
              isCompleted
                ? styles(theme).todoTextCompleted
                : styles(theme).todoText
            }
            numberOfLines={2}
          >
            {todo.text}
          </Text>
          <View style={styles(theme).todoMetaContainer}>
            <Text style={styles(theme).todoTime}>
              {format(parseISO(todo.createdAt), "hh:mm a")}
            </Text>
            <View style={styles(theme).todoIconsContainer}>
              {todo.notificationPreference &&
                todo.notificationPreference !== "none" && (
                  <Ionicons
                    name="notifications-outline"
                    size={12}
                    color={theme.secondaryText}
                    style={{ marginLeft: 4 }}
                  />
                )}
              {todo.recurring && (
                <Ionicons
                  name="repeat"
                  size={12}
                  color={theme.secondaryText}
                  style={{ marginLeft: 4 }}
                />
              )}
            </View>
          </View>
        </View>
      </View>
      <View style={styles(theme).todoActions}>
        <TouchableOpacity
          style={styles(theme).actionButton}
          onPress={handleEditPress}
          accessibilityLabel="Edit todo"
        >
          <Ionicons name="pencil-outline" size={20} color={theme.primary} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles(theme).actionButton}
          onPress={handleDelete}
          accessibilityLabel="Delete todo"
        >
          <Ionicons name="trash-outline" size={20} color={theme.error} />
        </TouchableOpacity>
      </View>
    </Pressable>
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
  onToggleTodo: (id: string, date: string) => void;
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
}) => {
  const { theme } = useTheme();
  // Animation for day section
  const expandAnim = useRef(new Animated.Value(expanded ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(expandAnim, {
      toValue: expanded ? 1 : 0,
      duration: 300,
      useNativeDriver: false,
      easing: Easing.inOut(Easing.ease),
    }).start();
  }, [expanded]);

  const maxHeight = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 1000],
  });

  const rotateArrow = expandAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "180deg"],
  });

  const isToday =
    format(date, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  return (
    <View
      style={[styles(theme).daySection, isToday && styles(theme).todaySection]}
    >
      <Pressable
        style={styles(theme).daySectionHeader}
        onPress={onToggle}
        android_ripple={{ color: theme.cardHighlight }}
        accessibilityLabel={`${day}, ${todos.length} todo${
          todos.length !== 1 ? "s" : ""
        }`}
      >
        <View style={styles(theme).daySectionHeaderLeft}>
          <Text style={styles(theme).daySectionTitle}>{day}</Text>
          <Text style={styles(theme).todoCount}>({todos.length})</Text>
        </View>
        <View style={styles(theme).daySectionHeaderRight}>
          {isToday && (
            <View style={styles(theme).todayBadge}>
              <Text style={styles(theme).todayText}>TODAY</Text>
            </View>
          )}
          <Animated.View style={{ transform: [{ rotate: rotateArrow }] }}>
            <Ionicons name="chevron-down" size={20} color={theme.primary} />
          </Animated.View>
        </View>
      </Pressable>

      <Animated.View
        style={[styles(theme).daySectionContentWrapper, { maxHeight }]}
      >
        <View style={styles(theme).daySectionContent}>
          <Text style={styles(theme).dateInfo}>
            {format(date, "MMMM d, yyyy")}
          </Text>
          {todos.length > 0 ? (
            todos.map((todo) => (
              <TodoItem
                key={todo.id + "_" + format(date, "yyyy-MM-dd")}
                todo={todo}
                date={date}
                onToggle={onToggleTodo}
                onDelete={onDelete}
                onEdit={onEdit}
              />
            ))
          ) : (
            <Text style={styles(theme).emptyList}>
              Nothing to do yet—add a task!
            </Text>
          )}
        </View>
      </Animated.View>
    </View>
  );
};

const styles = (theme: any) =>
  StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: theme.background,
    },
    content: {
      flex: 1,
      padding: 16,
    },
    weekNavigation: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: theme.card,
      borderRadius: 16,
      padding: 12,
      marginBottom: 16,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
      elevation: 5,
    },
    navigationButton: {
      padding: 8,
      borderRadius: 12,
      backgroundColor: theme.cardHighlight,
    },
    weekText: {
      fontWeight: "600",
      fontSize: 18,
      color: theme.text,
      textAlign: "center",
      marginBottom: 16,
    },
    fabContainer: {
      position: "absolute",
      bottom: 20,
      right: 20,
      shadowColor: theme.primary,
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.4,
      shadowRadius: 8,
      elevation: 8,
    },
    fab: {
      backgroundColor: theme.primary,
      width: 60,
      height: 60,
      borderRadius: 30,
      justifyContent: "center",
      alignItems: "center",
    },
    modalOverlay: {
      flex: 1,
      justifyContent: "center",
      alignItems: "center",
    },
    modalContent: {
      backgroundColor: theme.card,
      borderRadius: 20,
      padding: 24,
      width: "90%",
      maxWidth: 400,
      elevation: 5,
      alignItems: "center",
    },
    modalHandle: {
      width: 40,
      height: 5,
      backgroundColor: theme.separator,
      borderRadius: 3,
      marginBottom: 16,
    },
    modalTitle: {
      fontSize: 20,
      fontWeight: "bold",
      marginBottom: 16,
      color: theme.text,
      alignSelf: "flex-start",
    },
    input: {
      borderWidth: 1,
      borderColor: theme.separator,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      color: theme.text,
      width: "100%",
      backgroundColor: theme.cardHighlight,
    },
    daySelector: {
      borderWidth: 1,
      borderColor: theme.separator,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: theme.cardHighlight,
    },
    daySelectorText: {
      color: theme.text,
    },
    daySelectDropdown: {
      position: "absolute",
      top: 110,
      right: 0,
      backgroundColor: theme.card,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.separator,
      width: "100%",
      elevation: 5,
      zIndex: 1000,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.2,
      shadowRadius: 8,
    },
    daySelectItem: {
      padding: 14,
      borderBottomWidth: 1,
      borderBottomColor: theme.separator,
    },
    daySelectItemText: {
      color: theme.text,
    },
    modalButtons: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginTop: 16,
      width: "100%",
    },
    cancelButton: {
      padding: 14,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: theme.separator,
      alignItems: "center",
      flex: 1,
      marginRight: 8,
      backgroundColor: theme.cardHighlight,
    },
    cancelButtonText: {
      color: theme.text,
      fontWeight: "600",
    },
    addButton: {
      backgroundColor: theme.primary,
      padding: 14,
      borderRadius: 12,
      alignItems: "center",
      flex: 1,
    },
    addButtonText: {
      color: theme.card,
      fontWeight: "600",
    },
    deleteConfirmButton: {
      backgroundColor: theme.error,
      padding: 14,
      borderRadius: 12,
      alignItems: "center",
      flex: 1,
    },
    deleteConfirmButtonText: {
      color: "#ffffff",
      fontWeight: "600",
    },
    modalText: {
      marginBottom: 20,
      color: theme.text,
      textAlign: "center",
      lineHeight: 22,
    },
    daySection: {
      backgroundColor: theme.card,
      borderRadius: 16,
      marginBottom: 16,
      shadowColor: "#000",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 3,
      overflow: "hidden",
    },
    todaySection: {
      borderLeftWidth: 3,
      borderLeftColor: theme.primary,
    },
    daySectionHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 16,
    },
    daySectionHeaderLeft: {
      flexDirection: "row",
      alignItems: "center",
    },
    daySectionHeaderRight: {
      flexDirection: "row",
      alignItems: "center",
    },
    daySectionTitle: {
      fontSize: 18,
      fontWeight: "bold",
      color: theme.text,
    },
    todoCount: {
      fontSize: 14,
      color: theme.secondaryText,
      marginLeft: 8,
    },
    daySectionContentWrapper: {
      overflow: "hidden",
    },
    daySectionContent: {
      padding: 16,
      paddingTop: 0,
    },
    dateInfo: {
      fontSize: 14,
      color: theme.secondaryText,
      marginBottom: 16,
    },
    todoItem: {
      flexDirection: "row",
      alignItems: "center",
      padding: 12,
      borderRadius: 12,
      backgroundColor: theme.cardHighlight,
      marginBottom: 8,
    },
    checkboxContainer: {
      marginRight: 12,
    },
    customCheckbox: {
      width: 24,
      height: 24,
      borderRadius: 6,
      borderWidth: 2,
      justifyContent: "center",
      alignItems: "center",
    },
    todoTextContainer: {
      flex: 1,
    },
    todoText: {
      fontSize: 16,
      color: theme.text,
      marginBottom: 4,
    },
    todoTextCompleted: {
      fontSize: 16,
      color: theme.completed,
      marginBottom: 4,
      textDecorationLine: "line-through",
    },
    todoMetaContainer: {
      flexDirection: "row",
      alignItems: "center",
      gap: 2,
    },
    todoTime: {
      fontSize: 12,
      color: theme.secondaryText,
    },
    todoIconsContainer: {
      flexDirection: "row",
    },
    todoActions: {
      flexDirection: "row",
      alignItems: "center",
    },
    actionButton: {
      padding: 8,
      marginLeft: 4,
    },
    emptyList: {
      color: theme.secondaryText,
      fontSize: 14,
      fontStyle: "italic",
      textAlign: "center",
      padding: 16,
    },
    datePickerContainer: {
      backgroundColor: theme.card,
      padding: Platform.OS === "ios" ? 16 : 0,
      borderRadius: 16,
      width: "90%",
      maxWidth: 400,
    },
    datePickerHeader: {
      flexDirection: "row",
      justifyContent: "flex-end",
      marginBottom: 8,
    },
    datePickerDoneText: {
      color: theme.primary,
      fontSize: 16,
      fontWeight: "600",
    },
    filterContainer: {
      flexDirection: "row",
      justifyContent: "space-around",
      marginVertical: 16,
    },
    filterButton: {
      flex: 1,
      padding: 10,
      borderRadius: 12,
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
      borderColor: theme.separator,
      borderRadius: 12,
      padding: 14,
      marginBottom: 12,
      width: "100%",
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      backgroundColor: theme.cardHighlight,
    },
    timeSelectorText: {
      color: theme.text,
    },
    searchModalContent: {
      backgroundColor: theme.card,
      borderRadius: 20,
      padding: 24,
      width: "90%",
      maxWidth: 400,
      maxHeight: "80%",
      elevation: 5,
      alignItems: "center",
    },
    searchResultsContainer: {
      width: "100%",
      marginTop: 10,
      marginBottom: 16,
    },
    searchInputContainer: {
      flexDirection: "row",
      alignItems: "center",
      width: "100%",
      backgroundColor: theme.cardHighlight,
      borderRadius: 12,
      paddingHorizontal: 12,
      marginBottom: 16,
    },
    searchIcon: {
      marginRight: 8,
    },
    searchInput: {
      flex: 1,
      color: theme.text,
      padding: 12,
    },
    clearSearchButton: {
      padding: 8,
    },
    searchResultItem: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      padding: 16,
      borderRadius: 12,
      backgroundColor: theme.cardHighlight,
      marginBottom: 8,
    },
    searchResultTextContainer: {
      flex: 1,
    },
    searchResultTextMain: {
      fontSize: 16,
      color: theme.text,
      marginBottom: 4,
    },
    searchResultMeta: {
      flexDirection: "row",
      alignItems: "center",
    },
    searchResultDay: {
      fontSize: 12,
      color: theme.secondaryText,
      marginRight: 8,
    },
    searchResultDate: {
      fontSize: 12,
      color: theme.secondaryText,
    },
    searchResultIcons: {
      flexDirection: "row",
      alignItems: "center",
    },
    emptySearch: {
      fontSize: 14,
      color: theme.secondaryText,
      textAlign: "center",
      marginTop: 20,
    },
    closeSearchButton: {
      backgroundColor: theme.primary,
      padding: 14,
      borderRadius: 12,
      alignItems: "center",
      width: "100%",
    },
    closeSearchButtonText: {
      color: theme.card,
      fontWeight: "600",
    },
    searchButton: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: theme.cardHighlight,
      borderRadius: 12,
      padding: 10,
      marginHorizontal: 8,
    },
    searchButtonText: {
      color: theme.secondaryText,
      marginLeft: 8,
    },
    todayBadge: {
      backgroundColor: theme.primary,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: 8,
      marginRight: 8,
    },
    todayText: {
      color: theme.card,
      fontSize: 10,
      fontWeight: "bold",
    },
  });
