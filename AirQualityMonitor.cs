using System.Collections;
using System.Collections.Generic; // Added for Dictionary
using UnityEngine;
using UnityEngine.UI;
using UnityEngine.Networking;

// <<< แก้ไข: สร้าง Class ให้ตรงกับข้อมูลจาก ThingSpeak
[System.Serializable]
public class ThingSpeakData
{
    public string created_at;
    public int entry_id;
    public string field1; // Klong San PM2.5
    public string field2; // Thon Buri PM2.5
    public string field3; // Bang Rak PM2.5
}

// Wrapper สำหรับ parse feeds array
[System.Serializable]
public class ThingSpeakFeedsResponse
{
    public ThingSpeakData[] feeds;
}

// <<< เพิ่ม: Class สำหรับข้อมูล WAQI
[System.Serializable]
public class WAQIData
{
    public string status;
    public WAQIDataContent data;
}

[System.Serializable]
public class WAQIDataContent
{
    public int aqi;
    public WAQIIaqi iaqi;
}

[System.Serializable]
public class WAQIIaqi
{
    public WAQIPollutant pm25;
}

[System.Serializable]
public class WAQIPollutant
{
    public float v; // PM2.5 value
}

public class AirQualityMonitor : MonoBehaviour
{
    [Header("UI Elements")]
    [SerializeField] private Text klongSanAqiText;
    [SerializeField] private Text klongSanUgm3Text;
    [SerializeField] private Text klongSanStatusText;
    
    [SerializeField] private Text thonBuriAqiText;
    [SerializeField] private Text thonBuriUgm3Text;
    [SerializeField] private Text thonBuriStatusText;
    
    [SerializeField] private Text bangRakAqiText;
    [SerializeField] private Text bangRakUgm3Text;
    [SerializeField] private Text bangRakStatusText;
    
    [SerializeField] private Image klongSanProgressImage;
    [SerializeField] private Image thonBuriProgressImage;
    [SerializeField] private Image bangRakProgressImage;
    
    [Header("Settings")]
    [SerializeField] private string klongChannelId = "3027679";
    [SerializeField] private string klongReadKey = "4M306YRQZ87072KV";
    [SerializeField] private string thonChannelId = "3192372";
    [SerializeField] private string thonReadKey = "ZWT3K5EV765AJITU";
    [SerializeField] private string bangChannelId = "3192391";
    [SerializeField] private string bangReadKey = "862VYY6T19BO3KLK";
    [SerializeField] private string waqiToken = "75a1a645825e299fdd790d95235ca5192ef92d87";
    [SerializeField] private string[] waqiStations = { "bangkok", "bangkok", "bangkok" }; // WAQI stations สำหรับแต่ละเขต [0]=Klong San, [1]=Thon Buri, [2]=Bang Rak
    [SerializeField] private float updateInterval = 15f; // อัพเดททุก 15 วินาที (เหมือนเว็บ)
    [SerializeField] private float animationSpeed = 0.5f;
    
    [Header("Progress Animation")]
    [SerializeField] private bool enableAnimation = true;
    
    // เก็บค่า PM2.5 และ AQI ของแต่ละเขต
    private float[] currentPM25Values = new float[3]; // [0]=Klong San, [1]=Thon Buri, [2]=Bang Rak
    private float[] currentAQIValues = new float[3];
    private float[] targetFillAmounts = new float[3];
    private float[] currentFillAmounts = new float[3];
    private float animationTime = 0f;
    private bool isAnimating = false;
    
    // Cache ข้อมูลล่าสุด - ทั้ง 3 เขต
    private static float[] cachedPM25 = { -1f, -1f, -1f }; // -1 = ไม่มีข้อมูล
    private static float[] cachedAQI = { -1f, -1f, -1f };
    private static bool hasValidCache = false;
    
    void Start()
    {
        // แสดงค่าเริ่มต้นทันที
        SetInitialValues();
        StartCoroutine(UpdateAirQualityDataPeriodically());
    }
    
    void OnEnable()
    {
        // เรียกดึงข้อมูลทันทีเมื่อ GameObject ถูก activate
        if (gameObject.activeInHierarchy)
        {
            StartCoroutine(FetchAirQualityDataImmediate());
        }
    }
    
    private IEnumerator FetchAirQualityDataImmediate()
    {
        yield return StartCoroutine(FetchAirQualityData());
    }
    
    private void SetInitialValues()
    {
        // ใช้ cache ถ้ามี หรือแสดงค่าเริ่มต้น
        if (hasValidCache)
        {
            for (int i = 0; i < 3; i++)
            {
                currentPM25Values[i] = cachedPM25[i];
                currentAQIValues[i] = cachedAQI[i];
            }
            UpdateAllUI();
        }
        else
        {
            // ยังไม่มีข้อมูล - แสดง Loading state สำหรับทั้ง 3 เขต
            for (int i = 0; i < 3; i++)
            {
                currentPM25Values[i] = -1f;
                currentAQIValues[i] = -1f;
            }
            
            UpdateAllUI();
        }
    }
    
    void Update()
    {
        if (enableAnimation && isAnimating)
        {
            animationTime += Time.deltaTime * animationSpeed;
            
            // อัพเดท Fill Amount สำหรับทั้ง 3 เขต
            for (int i = 0; i < 3; i++)
            {
                currentFillAmounts[i] = Mathf.Lerp(currentFillAmounts[i], targetFillAmounts[i], animationTime);
            }
            
            if (klongSanProgressImage != null) klongSanProgressImage.fillAmount = currentFillAmounts[0];
            if (thonBuriProgressImage != null) thonBuriProgressImage.fillAmount = currentFillAmounts[1];
            if (bangRakProgressImage != null) bangRakProgressImage.fillAmount = currentFillAmounts[2];
            
            if (animationTime >= 1f)
            {
                isAnimating = false;
                // ทำให้แน่ใจว่าค่าสุดท้ายถูกต้อง
                if (klongSanProgressImage != null) klongSanProgressImage.fillAmount = targetFillAmounts[0];
                if (thonBuriProgressImage != null) thonBuriProgressImage.fillAmount = targetFillAmounts[1];
                if (bangRakProgressImage != null) bangRakProgressImage.fillAmount = targetFillAmounts[2];
            }
        }
    }
    
    private IEnumerator UpdateAirQualityDataPeriodically()
    {
        while (true)
        {
            yield return StartCoroutine(FetchAirQualityData());
            yield return new WaitForSeconds(updateInterval);
        }
    }
    
    private IEnumerator FetchAirQualityData()
    {
        // 1. ดึงข้อมูล PM2.5 จาก ThingSpeak (แยกแต่ละเขต)
        float[] thingSpeakPM25 = { -1f, -1f, -1f };
        string[] districtNames = { "Klong San", "Thon Buri", "Bang Rak" };
        
        string[] channelIds = { klongChannelId, thonChannelId, bangChannelId };
        string[] readKeys = { klongReadKey, thonReadKey, bangReadKey };
        
        for (int i = 0; i < 3; i++)
        {
            string thingSpeakURL = $"https://api.thingspeak.com/channels/{channelIds[i]}/fields/1/last.txt?api_key={readKeys[i]}";
            UnityWebRequest thingSpeakRequest = UnityWebRequest.Get(thingSpeakURL);
            yield return thingSpeakRequest.SendWebRequest();
            
            if (thingSpeakRequest.result == UnityWebRequest.Result.Success)
            {
                try
                {
                    string value = thingSpeakRequest.downloadHandler.text.Trim();
                    if (!string.IsNullOrEmpty(value) && float.TryParse(value, out float pm25Value))
                    {
                        thingSpeakPM25[i] = pm25Value;
                        Debug.Log($"✓ ThingSpeak {districtNames[i]}: {pm25Value:F1} µg/m³");
                    }
                    else
                    {
                        Debug.LogWarning($"✗ ThingSpeak {districtNames[i]}: No data");
                    }
                }
                catch (System.Exception e)
                {
                    Debug.LogError($"Error parsing ThingSpeak {districtNames[i]}: {e.Message}");
                }
            }
            else
            {
                Debug.LogError($"Error fetching ThingSpeak {districtNames[i]}: {thingSpeakRequest.error}");
            }
            
            thingSpeakRequest.Dispose();
            yield return new WaitForSeconds(0.1f); // Delay prevent rate limit
        }
        
        // 2. ดึงข้อมูลจาก WAQI (Optimize: Fetch unique stations only)
        float[] waqiPM25Values = { -1f, -1f, -1f };
        Dictionary<string, float> waqiCache = new Dictionary<string, float>();
        
        for (int i = 0; i < 3; i++)
        {
            string station = waqiStations[i];
            if (string.IsNullOrEmpty(station)) continue;
            
            float waqiValue = -1f;
            
            // Check cache first
            if (waqiCache.ContainsKey(station))
            {
                waqiValue = waqiCache[station];
                Debug.Log($"✓ WAQI {districtNames[i]} (Cached '{station}'): {waqiValue:F1} µg/m³");
            }
            else
            {
                // Fetch from API
                string waqiURL = $"https://api.waqi.info/feed/{station}/?token={waqiToken}";
                UnityWebRequest waqiRequest = UnityWebRequest.Get(waqiURL);
                yield return waqiRequest.SendWebRequest();
                
                if (waqiRequest.result == UnityWebRequest.Result.Success)
                {
                    try
                    {
                        string jsonResponse = waqiRequest.downloadHandler.text;
                        if (!string.IsNullOrEmpty(jsonResponse) && jsonResponse.StartsWith("{"))
                        {
                            WAQIData waqiData = JsonUtility.FromJson<WAQIData>(jsonResponse);
                            if (waqiData.status == "ok" && waqiData.data != null && waqiData.data.iaqi != null && waqiData.data.iaqi.pm25 != null)
                            {
                                waqiValue = waqiData.data.iaqi.pm25.v;
                                waqiCache[station] = waqiValue; // Cache it
                                Debug.Log($"✓ WAQI {districtNames[i]} (API '{station}'): {waqiValue:F1} µg/m³");
                            }
                        }
                    }
                    catch (System.Exception e) { Debug.LogError($"WAQI Parse Error: {e.Message}"); }
                }
                else
                {
                    Debug.LogError($"WAQI Fetch Error {station}: {waqiRequest.error}");
                }
                waqiRequest.Dispose();
                yield return new WaitForSeconds(0.5f); // Delay for API safety
            }
            
            waqiPM25Values[i] = waqiValue;
        }
        
        // 3. คำนวณค่าเฉลี่ยและอัพเดท UI
        bool hasAnyValidData = false;
        
        for (int i = 0; i < 3; i++)
        {
            float tsPM = thingSpeakPM25[i];
            float waqiPM = waqiPM25Values[i];
            float finalPM25 = -1f;
            
            if (tsPM >= 0 && waqiPM >= 0)
            {
                finalPM25 = (tsPM + waqiPM) / 2f;
                Debug.Log($"{districtNames[i]}: TS={tsPM:F1}, WAQI={waqiPM:F1} => Avg={finalPM25:F1}");
            }
            else if (tsPM >= 0)
            {
                finalPM25 = tsPM;
                Debug.Log($"{districtNames[i]}: TS Only={tsPM:F1}");
            }
            else if (waqiPM >= 0)
            {
                finalPM25 = waqiPM;
                Debug.Log($"{districtNames[i]}: WAQI Only={waqiPM:F1}");
            }
            
            if (finalPM25 >= 0)
            {
                currentPM25Values[i] = finalPM25;
                currentAQIValues[i] = CalculateAQI(finalPM25);
                cachedPM25[i] = finalPM25;
                cachedAQI[i] = currentAQIValues[i];
                hasAnyValidData = true;
            }
            else
            {
                currentPM25Values[i] = -1f;
                currentAQIValues[i] = -1f;
            }
        }
        
        if (hasAnyValidData)
        {
            hasValidCache = true;
            UpdateAllUI();
        }
        else
        {
            SetErrorState();
        }
    }
    
    private int CalculateAQI(float pm25)
    {
        // Thai AQI Standard
        // 0-25 -> 0-25
        // 26-37 -> 26-50
        // 38-50 -> 51-100
        // 51-90 -> 101-200
        // >90 -> >200
        
        if (pm25 <= 25.0f)
            return Mathf.RoundToInt(((25f - 0f) / (25.0f - 0.0f)) * (pm25 - 0.0f) + 0f);
        if (pm25 <= 37.0f)
            return Mathf.RoundToInt(((50f - 26f) / (37.0f - 25.1f)) * (pm25 - 25.1f) + 26f);
        if (pm25 <= 50.0f)
            return Mathf.RoundToInt(((100f - 51f) / (50.0f - 37.1f)) * (pm25 - 37.1f) + 51f);
        if (pm25 <= 90.0f)
            return Mathf.RoundToInt(((200f - 101f) / (90.0f - 50.1f)) * (pm25 - 50.1f) + 101f);
            
        // Extrapolated for > 90
        return Mathf.RoundToInt(((600f - 201f) / (600.0f - 90.1f)) * (pm25 - 90.1f) + 201f);
    }

    private string GetQualityStatus(float pm25)
    {
        // Status word (Thai Standard)
        int aqi = CalculateAQI(pm25);
        if (aqi <= 25) return "Very Good";
        if (aqi <= 50) return "Good";
        if (aqi <= 100) return "Moderate";
        if (aqi <= 200) return "Unhealthy";
        return "Very Unhealthy";
    }
    
    private void UpdateAllUI()
    {
        string[] districtNames = { "Klong San", "Thon Buri", "Bang Rak" };
        Text[] aqiTexts = { klongSanAqiText, thonBuriAqiText, bangRakAqiText };
        Text[] ugm3Texts = { klongSanUgm3Text, thonBuriUgm3Text, bangRakUgm3Text };
        Text[] statusTexts = { klongSanStatusText, thonBuriStatusText, bangRakStatusText };
        
        for (int i = 0; i < 3; i++)
        {
            // ตรวจสอบว่ามีข้อมูลหรือไม่
            if (currentPM25Values[i] >= 0 && currentAQIValues[i] >= 0)
            {
                // มีข้อมูล - แสดงค่าปกติ
                if (aqiTexts[i] != null)
                    aqiTexts[i].text = currentAQIValues[i].ToString("F0");
                
                if (ugm3Texts[i] != null)
                    ugm3Texts[i].text = currentPM25Values[i].ToString("F1");
                
                if (statusTexts[i] != null)
                    statusTexts[i].text = GetQualityStatus(currentPM25Values[i]);
                
                targetFillAmounts[i] = Mathf.Clamp01(currentAQIValues[i] / 500f);
            }
            else
            {
                // ไม่มีข้อมูล - แสดง N/A
                if (aqiTexts[i] != null)
                    aqiTexts[i].text = "---";
                
                if (ugm3Texts[i] != null)
                    ugm3Texts[i].text = "N/A";
                
                if (statusTexts[i] != null)
                    statusTexts[i].text = "No Data";
                
                targetFillAmounts[i] = 0f;
            }
        }
        
        if (enableAnimation)
        {
            isAnimating = true;
            animationTime = 0f;
        }
        else
        {
            // อัพเดทโดยไม่มี Animation
            if (klongSanProgressImage != null) klongSanProgressImage.fillAmount = targetFillAmounts[0];
            if (thonBuriProgressImage != null) thonBuriProgressImage.fillAmount = targetFillAmounts[1];
            if (bangRakProgressImage != null) bangRakProgressImage.fillAmount = targetFillAmounts[2];
        }
    }
    
    private void SetErrorState()
    {
        string[] districtNames = { "Klong San", "Thon Buri", "Bang Rak" };
        Text[] aqiTexts = { klongSanAqiText, thonBuriAqiText, bangRakAqiText };
        Text[] ugm3Texts = { klongSanUgm3Text, thonBuriUgm3Text, bangRakUgm3Text };
        Text[] statusTexts = { klongSanStatusText, thonBuriStatusText, bangRakStatusText };
        
        for (int i = 0; i < 3; i++)
        {
            if (aqiTexts[i] != null) aqiTexts[i].text = "Error";
            if (ugm3Texts[i] != null) ugm3Texts[i].text = "--";
            if (statusTexts[i] != null) statusTexts[i].text = "Connection Error";
        }
    }
}