using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Networking;

[System.Serializable]
public class WeatherData
{
    public Main main;
}

[System.Serializable]
public class Main
{
    public float temp; // metric Celsius
}

[System.Serializable]
public class DistrictColorElements
{
    [Header("District Color Elements")]
    public List<Image> colorChangingElements = new List<Image>();

    [Header("Text Color Elements")]
    public List<Text> colorChangingTexts = new List<Text>();

    [Header("Temperature Status Images")]
    public List<Image> temperatureStatusImages = new List<Image>();

    [Space(5)]
    public bool showAddButton = true;
}

public class WeatherUIManager : MonoBehaviour
{
    [Header("Temperature Display UI")]
    [SerializeField] private Text khlongSanTempText;
    [SerializeField] private Text thonBuriTempText;
    [SerializeField] private Text bangRakTempText;
    [SerializeField] private Text averageTempText;

    [Header("Color Changing Elements")]
    [SerializeField] private DistrictColorElements khlongSanColorElements = new DistrictColorElements();
    [SerializeField] private DistrictColorElements thonBuriColorElements = new DistrictColorElements();
    [SerializeField] private DistrictColorElements bangRakColorElements = new DistrictColorElements();

    [Header("Temperature Color Settings")]
    [SerializeField] private float minTemp = 20f;
    [SerializeField] private float maxTemp = 40f;

    [Header("Image Colors")]
    [SerializeField] private Color coldColor = new Color(0.2f, 0.6f, 1f, 1f);
    [SerializeField] private Color hotColor = new Color(1f, 0.3f, 0.1f, 1f);

    [Header("Text Colors")]
    [SerializeField] private Color coldTextColor = new Color(0.1f, 0.4f, 0.8f, 1f);
    [SerializeField] private Color hotTextColor = new Color(0.8f, 0.2f, 0.05f, 1f);

    [Header("Temperature Status Button Colors")]
    [SerializeField] private Color coldImageColor = new Color(0f, 1f, 0.067f, 1f); // <25
    [SerializeField] private Color normalImageColor = new Color(1f, 1f, 1f, 1f);   // 25-35
    [SerializeField] private Color hotImageColor = new Color(1f, 0f, 0f, 1f);      // >35

    [Header("OpenWeatherMap Settings")]
    [SerializeField] private string apiKey = "777b3dd9f7d7c557345e420d99f6c144";
    [SerializeField] private float updateInterval = 300f;

    // ======= NEW: ThingSpeak per-district config =======
    [System.Serializable]
    public class ThingSpeakDistrictConfig
    {
        public string districtName;
        public string channelId;
        public string readApiKey;
        public int fieldNumber;
    }

    [Header("ThingSpeak District Configs (Khlong San / Thon Buri / Bang Rak)")]
    [SerializeField] private ThingSpeakDistrictConfig[] thingSpeakConfigs = new ThingSpeakDistrictConfig[3]
    {
        new ThingSpeakDistrictConfig { districtName = "Khlong San", channelId = "3027679", readApiKey = "4M306YRQZ87072KV", fieldNumber = 4 },
        new ThingSpeakDistrictConfig { districtName = "Thon Buri",  channelId = "3192372", readApiKey = "ZWT3K5EV765AJITU", fieldNumber = 2 },
        new ThingSpeakDistrictConfig { districtName = "Bang Rak",   channelId = "3192391", readApiKey = "862VYY6T19BO3KLK", fieldNumber = 2 },
    };
    // ===================================================

    private Text[] temperatureTexts;
    private DistrictColorElements[] districtColorElements;

    private float[] currentTemperatures = new float[3] { -1f, -1f, -1f };

    // ใช้ชื่อเมืองเหมือนเดิม (ถ้าคุณอยากให้ชัวร์ ควรเปลี่ยนเป็น lat/lon)
    private readonly string[] locationNamesAPI = { "Khlong San", "Thon Buri", "Bang Rak" };

    void Start()
    {
        temperatureTexts = new Text[] { khlongSanTempText, thonBuriTempText, bangRakTempText };
        districtColorElements = new DistrictColorElements[] { khlongSanColorElements, thonBuriColorElements, bangRakColorElements };

        SetInitialTemperatures();
        StartCoroutine(UpdateTemperaturesPeriodically());
    }

    void OnEnable()
    {
        if (gameObject.activeInHierarchy && temperatureTexts != null)
        {
            StopAllCoroutines();
            StartCoroutine(UpdateTemperaturesPeriodically());
            StartCoroutine(UpdateAllTemperaturesImmediate());
        }
    }

    private void SetInitialTemperatures()
    {
        for (int i = 0; i < currentTemperatures.Length; i++)
        {
            currentTemperatures[i] = -1f;
            if (temperatureTexts[i] != null) temperatureTexts[i].text = "N/A";
        }
        UpdateAverageTemperature();
    }

    private IEnumerator UpdateAllTemperaturesImmediate()
    {
        yield return StartCoroutine(UpdateAllTemperatures());
    }

    private IEnumerator UpdateTemperaturesPeriodically()
    {
        while (true)
        {
            yield return StartCoroutine(UpdateAllTemperatures());
            yield return new WaitForSeconds(updateInterval);
        }
    }

    private IEnumerator UpdateAllTemperatures()
    {
        Debug.Log("=== Fetching Temperature Data (ThingSpeak per district + OpenWeatherMap) ===");

        for (int i = 0; i < 3; i++)
        {
            var cfg = thingSpeakConfigs[i];
            string districtName = cfg.districtName;

            // 1) ThingSpeak (per district)
            float tsTemp = -1f;
            string tsURL = $"https://api.thingspeak.com/channels/{cfg.channelId}/fields/{cfg.fieldNumber}/last.txt?api_key={cfg.readApiKey}";
            using (UnityWebRequest tsReq = UnityWebRequest.Get(tsURL))
            {
                yield return tsReq.SendWebRequest();

                if (tsReq.result == UnityWebRequest.Result.Success)
                {
                    string raw = (tsReq.downloadHandler.text ?? "").Trim();
                    Debug.Log($"[{districtName}] ThingSpeak raw: '{raw}'");

                    // ถ้าว่าง/ไม่มีข้อมูล จะได้ raw ว่าง หรือ parse ไม่ผ่าน
                    if (!string.IsNullOrEmpty(raw) && float.TryParse(raw, out float parsed) && parsed > -100f && parsed < 100f)
                    {
                        tsTemp = parsed;
                        Debug.Log($"✓ [{districtName}] ThingSpeak: {tsTemp:F1}°C");
                    }
                    else
                    {
                        Debug.LogWarning($"! [{districtName}] ThingSpeak has no valid data -> will use OWM only");
                    }
                }
                else
                {
                    Debug.LogWarning($"! [{districtName}] ThingSpeak error: {tsReq.error} -> will use OWM only");
                }
            }

            // 2) OpenWeatherMap
            float owmTemp = -1f;
            string owmURL = $"https://api.openweathermap.org/data/2.5/weather?q={UnityWebRequest.EscapeURL(locationNamesAPI[i])}&units=metric&appid={apiKey}";
            using (UnityWebRequest owmReq = UnityWebRequest.Get(owmURL))
            {
                yield return owmReq.SendWebRequest();

                if (owmReq.result == UnityWebRequest.Result.Success)
                {
                    try
                    {
                        WeatherData data = JsonUtility.FromJson<WeatherData>(owmReq.downloadHandler.text);
                        if (data != null && data.main != null)
                        {
                            owmTemp = data.main.temp;
                            Debug.Log($"✓ [{districtName}] OpenWeatherMap: {owmTemp:F1}°C");
                        }
                    }
                    catch (System.Exception e)
                    {
                        Debug.LogWarning($"! [{districtName}] OWM parse error: {e.Message}");
                    }
                }
                else
                {
                    Debug.LogWarning($"! [{districtName}] OWM error: {owmReq.error}");
                }
            }

            // 3) Final temperature:
            //    - ถ้า TS มีค่า -> เฉลี่ยกับ OWM (ถ้า OWM มีค่า)
            //    - ถ้า TS ไม่มี -> ใช้ OWM อย่างเดียว
            float finalTemp = -1f;

            if (tsTemp >= 0f && owmTemp >= 0f)
            {
                finalTemp = (tsTemp + owmTemp) / 2f;
                Debug.Log($"<color=green>[{districtName}] Final = (TS {tsTemp:F1} + OWM {owmTemp:F1})/2 = {finalTemp:F1}°C</color>");
            }
            else if (owmTemp >= 0f)
            {
                finalTemp = owmTemp; // ✅ ตามที่คุณต้องการ: TS ไม่มีข้อมูล -> ใช้ API อย่างเดียว
                Debug.Log($"[{districtName}] Final = OWM only = {finalTemp:F1}°C");
            }
            else if (tsTemp >= 0f)
            {
                finalTemp = tsTemp; // กันกรณี OWM ล้มเหลว แต่ TS มีค่า
                Debug.Log($"[{districtName}] Final = TS only (OWM failed) = {finalTemp:F1}°C");
            }
            else
            {
                Debug.LogWarning($"[{districtName}] Final = N/A (both sources missing)");
            }

            // 4) Update UI
            if (finalTemp >= 0f)
            {
                currentTemperatures[i] = finalTemp;
                if (temperatureTexts[i] != null)
                {
                    temperatureTexts[i].text = finalTemp.ToString("F1") + "°C";
                    UpdateTemperatureColors(finalTemp, i);
                }
            }
            else
            {
                currentTemperatures[i] = -1f;
                if (temperatureTexts[i] != null) temperatureTexts[i].text = "N/A";
            }
        }

        UpdateAverageTemperature();
    }

    private void UpdateAverageTemperature()
    {
        float total = 0f;
        int count = 0;

        for (int i = 0; i < currentTemperatures.Length; i++)
        {
            if (currentTemperatures[i] > 0f)
            {
                total += currentTemperatures[i];
                count++;
            }
        }

        if (averageTempText != null)
        {
            averageTempText.text = (count > 0) ? (total / count).ToString("F1") + "°C" : "N/A";
        }

        if (count > 0) Debug.Log($"Average Temperature: {total / count:F1}°C (from {count} districts)");
    }

    private void UpdateTemperatureColors(float temperature, int districtIndex)
    {
        if (districtIndex < 0 || districtIndex >= districtColorElements.Length) return;

        DistrictColorElements colorElements = districtColorElements[districtIndex];

        float t = Mathf.Clamp01((temperature - minTemp) / (maxTemp - minTemp));
        Color tempColor = Color.Lerp(coldColor, hotColor, t);
        Color textColor = Color.Lerp(coldTextColor, hotTextColor, t);

        foreach (Image img in colorElements.colorChangingElements)
        {
            if (img != null) img.color = tempColor;
        }

        foreach (Text txt in colorElements.colorChangingTexts)
        {
            if (txt != null) txt.color = textColor;
        }

        Color statusColor = GetTemperatureStatusColor(temperature);
        foreach (Image img in colorElements.temperatureStatusImages)
        {
            if (img != null) img.color = statusColor;
        }
    }

    private Color GetTemperatureStatusColor(float temperature)
    {
        if (temperature < 25f) return coldImageColor;
        if (temperature <= 35f) return normalImageColor;
        return hotImageColor;
    }

    // ====== Helpers / Public APIs (คงไว้ตามเดิม) ======
    public float GetAverageTemperature()
    {
        float total = 0f;
        int count = 0;
        for (int i = 0; i < currentTemperatures.Length; i++)
        {
            if (currentTemperatures[i] > 0f) { total += currentTemperatures[i]; count++; }
        }
        return count > 0 ? total / count : 0f;
    }

    public float[] GetAllTemperatures()
    {
        return (float[])currentTemperatures.Clone();
    }

    public string GetTemperatureStatus(float temperature)
    {
        if (temperature < 25f) return "Cold";
        if (temperature <= 35f) return "Normal";
        return "Hot";
    }

    public Color GetTemperatureStatusColorPublic(float temperature)
    {
        return GetTemperatureStatusColor(temperature);
    }

    [ContextMenu("Update Temperatures Now")]
    public void UpdateTemperaturesManually()
    {
        StartCoroutine(UpdateAllTemperatures());
    }
}
